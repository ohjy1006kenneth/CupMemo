// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrewEntry } from '../apps/web/src/components/brew-entry';
const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const id = '00000000-0000-4000-8000-000000000001';
const coffee = {
  id,
  name: 'Hamasho',
  roaster: 'SEY',
  country: null,
  region: null,
  producer: null,
  farmStation: null,
  variety: null,
  process: null,
  elevation: null,
  roastDate: null,
  tastingNotes: ['Peach'],
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};
const page = (coffees = [coffee], offset = 0, hasMore = false) =>
  Response.json({ coffees, pagination: { limit: 20, offset, hasMore } });
const emptyLatest = () =>
  Response.json({ brews: [], pagination: { limit: 1, offset: 0, hasMore: false } });
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function ready() {
  fetcher.mockResolvedValueOnce(page()).mockResolvedValueOnce(emptyLatest());
  const view = render(<BrewEntry />);
  fireEvent.click(await screen.findByRole('button', { name: 'SEY · Hamasho' }));
  await screen.findByRole('heading', { name: 'Make it yours' });
  return view;
}
async function taste() {
  const view = await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to tasting' }));
  return view;
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'Save brew & tasting' }).closest('form')!);
}
beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('selects only real coffees, loads latest separately, and continues without a POST or seeded tasting', async () => {
  await ready();
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    '/api/v1/coffees?limit=20&offset=0',
    `/api/v1/brews?coffeeId=${id}&limit=1&offset=0`,
  ]);
  for (const [, options] of fetcher.mock.calls)
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
  expect(screen.getByText(/Starter recipe/)).toBeVisible();
  expect(screen.getByLabelText('Grind setting (required)')).toHaveValue('6.2');
  fireEvent.click(screen.getByRole('button', { name: 'Continue to tasting' }));
  expect(screen.getByRole('heading', { name: 'How did it taste?' })).toBeVisible();
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(null);
  expect(screen.getAllByText('Not rated')).toHaveLength(3);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('posts strict user-selected overall-only data exactly once and confirms matching 201 to Journal', async () => {
  await taste();
  fill('Overall score /100 (required)', '87.25');
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    submit();
    submit();
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url, options] = fetcher.mock.calls[2];
  expect(url).toBe('/api/v1/brews');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
  const payload = JSON.parse(options.body);
  expect(payload).toMatchObject({
    coffeeId: id,
    overallScore: 87.25,
    tastingMode: 'quick',
    acidity: null,
    body: null,
    aftertaste: null,
    tastingTags: [],
    notes: null,
  });
  expect(payload).not.toHaveProperty('ratio');
  expect(payload.pours[0]).toEqual({ waterGrams: 50, startTimeSeconds: 0 });
  expect(screen.getByRole('button', { name: 'Saving brew…' })).toBeDisabled();
  await act(async () =>
    resolve(
      Response.json(
        {
          brew: {
            ...payload,
            id: '00000000-0000-4000-8000-000000000002',
            pours: payload.pours.map((p: object, position: number) => ({ ...p, position })),
            createdAt: coffee.createdAt,
            updatedAt: coffee.updatedAt,
          },
        },
        { status: 201 },
      ),
    ),
  );
  expect(replace).toHaveBeenCalledWith('/app/journal');
  expect(refresh).toHaveBeenCalledOnce();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
it('back retains notation, pours, optional zero and independent score; grinder change clears incompatible setting', async () => {
  await ready();
  fill('Grind setting (required)', '6.2 marks');
  fireEvent.click(screen.getByRole('button', { name: 'Continue to tasting' }));
  fill('Overall score /100 (required)', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Add Acidity rating' }));
  expect(screen.getByLabelText('Acidity quality /10')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button', { name: 'Peach' }));
  fill('Tasting notes (optional)', 'Bright');
  fireEvent.click(screen.getByRole('button', { name: 'Back to recipe' }));
  expect(screen.getByLabelText('Grind setting (required)')).toHaveValue('6.2 marks');
  fireEvent.click(screen.getByRole('button', { name: 'Continue to tasting' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
  expect(screen.getByRole('button', { name: 'Peach' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Tasting notes (optional)')).toHaveValue('Bright');
  fireEvent.click(screen.getByRole('button', { name: 'Clear Acidity rating' }));
  expect(screen.getAllByText('Not rated')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Back to recipe' }));
  fill('Grinder', 'Comandante C40');
  expect(screen.getByLabelText('Grind setting (required)')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Continue to tasting' })).toBeDisabled();
});
it('mismatch resolution and cumulative display preserve increments and reorder amounts at fixed start slots', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Scale target' }));
  expect(screen.getByLabelText('Pour 2 incremental water (g)')).toHaveValue(100);
  fireEvent.click(screen.getByRole('button', { name: 'Move pour 1 later' }));
  expect(screen.getByLabelText('Pour 1 incremental water (g)')).toHaveValue(100);
  expect(screen.getByLabelText('Pour 1 start (seconds)')).toHaveValue(0);
  expect(screen.getByLabelText('Pour 2 incremental water (g)')).toHaveValue(50);
  expect(screen.getByLabelText('Pour 2 start (seconds)')).toHaveValue(45);
  fireEvent.click(screen.getByRole('button', { name: 'Add 5g to pour 1' }));
  expect(screen.getByRole('button', { name: 'Continue to tasting' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use pour total as water amount' }));
  expect(screen.getByLabelText('Water (g)')).toHaveValue(255);
  expect(screen.getByRole('button', { name: 'Continue to tasting' })).toBeEnabled();
});
it.each([400, 403, 404, 413, 415])(
  'retains declined %s and allows only deliberate correction',
  async (status) => {
    await taste();
    fill('Overall score /100 (required)', '0');
    fetcher.mockResolvedValueOnce(new Response('', { status }));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 404 ? 'coffee is unavailable' : 'not saved',
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Save brew & tasting' })).toBeEnabled();
  },
);
it.each([200, 202, 500, 503])(
  'permanently locks uncertain %s draft even after edits',
  async (status) => {
    await taste();
    fill('Overall score /100 (required)', '0');
    fetcher.mockResolvedValueOnce(new Response('', { status }));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    fill('Overall score /100 (required)', '99');
    submit();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Check journal' })).toHaveAttribute(
      'href',
      '/app/journal',
    );
  },
);
it('401 clears all private data and navigates to fixed signin', async () => {
  await taste();
  fill('Overall score /100 (required)', '0');
  fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  expect(screen.queryByText(/Hamasho/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Overall score /100 (required)')).not.toBeInTheDocument();
});
it('pristine chooser cancels without warning; initialized draft requires explicit discard and decline preserves it', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fetcher.mockResolvedValueOnce(page([]));
  const pristine = render(<BrewEntry />);
  await screen.findByText('No coffees yet');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).not.toHaveBeenCalled();
  pristine.unmount();
  replace.mockClear();
  const view = await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Change coffee' }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  fetcher.mockResolvedValueOnce(page());
  fireEvent.click(screen.getByRole('button', { name: 'Change coffee' }));
  await screen.findByRole('heading', { name: 'Choose a coffee' });
  view.unmount();
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
it('replaces pages instead of appending, validates requested offset, and clears rows on page failure', async () => {
  fetcher
    .mockResolvedValueOnce(page([coffee], 0, true))
    .mockResolvedValueOnce(page([{ ...coffee, name: 'Page two' }], 20));
  render(<BrewEntry />);
  await screen.findByRole('button', { name: 'SEY · Hamasho' });
  fireEvent.click(screen.getByRole('button', { name: 'Next coffees' }));
  await screen.findByRole('button', { name: 'SEY · Page two' });
  expect(screen.queryByRole('button', { name: 'SEY · Hamasho' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/coffees?limit=20&offset=20');
  fetcher.mockResolvedValueOnce(page([coffee], 20));
  fireEvent.click(screen.getByRole('button', { name: 'Previous coffees' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByRole('button', { name: 'SEY · Page two' })).not.toBeInTheDocument();
});
it('failed latest lookup is retryable, never an empty/starter fallback', async () => {
  fetcher
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValueOnce(emptyLatest());
  render(<BrewEntry />);
  fireEvent.click(await screen.findByRole('button', { name: 'SEY · Hamasho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry before starting');
  expect(screen.queryByText(/Starter recipe/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry latest recipe' }));
  expect(await screen.findByText(/Starter recipe/)).toBeVisible();
});
it('latest sensory brew copies only exact recipe and strips all assessment, source time and output fields', async () => {
  const latest = {
    coffeeId: id,
    id: '00000000-0000-4000-8000-000000000002',
    brewer: 'Custom dripper',
    grinder: 'Custom grinder',
    grindSetting: '22 clicks',
    doseGrams: 15.29,
    waterGrams: 250.29,
    waterTemperatureC: 90.29,
    totalBrewTimeSeconds: 180,
    brewedAt: coffee.createdAt,
    overallScore: 99,
    tastingMode: 'sensory',
    acidity: 8,
    body: 9,
    aftertaste: 7,
    fragranceAroma: 8,
    flavor: 9,
    balance: 7,
    sweetness: 8,
    overallImpression: 8,
    tastingTags: ['Peach'],
    notes: 'Prior private notes',
    pours: [{ waterGrams: 250.29, startTimeSeconds: 15, position: 0 }],
    createdAt: coffee.createdAt,
    updatedAt: coffee.updatedAt,
  };
  fetcher
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(
      Response.json({ brews: [latest], pagination: { limit: 1, offset: 0, hasMore: false } }),
    );
  render(<BrewEntry />);
  fireEvent.click(await screen.findByRole('button', { name: 'SEY · Hamasho' }));
  await screen.findByText('Based on your latest brew');
  expect(screen.getByLabelText('Other brewer (required)')).toHaveValue('Custom dripper');
  expect(screen.getByLabelText('Other grinder (required)')).toHaveValue('Custom grinder');
  expect(screen.getByLabelText('Coffee dose (g)')).toHaveValue(15.29);
  expect(screen.getByLabelText('Grind setting (required)')).toHaveValue('22 clicks');
  fill('Temperature (°C)', '91.29');
  expect(screen.getByText(/Changed:/)).toHaveTextContent('90.29 → 91.29');
  fireEvent.click(screen.getByRole('button', { name: 'Continue to tasting' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(null);
  expect(screen.getAllByText('Not rated')).toHaveLength(3);
  expect(screen.getByLabelText('Tasting notes (optional)')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Peach' })).toHaveAttribute('aria-pressed', 'false');
});
it('late lookup A cannot initialize B even if abort is ignored', async () => {
  let resolveA!: (response: Response) => void;
  const b = { ...coffee, id: '00000000-0000-4000-8000-000000000002', name: 'Coffee B' };
  fetcher
    .mockResolvedValueOnce(page())
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveA = done;
        }),
    )
    .mockResolvedValueOnce(page([b]))
    .mockResolvedValueOnce(emptyLatest());
  render(<BrewEntry />);
  fireEvent.click(await screen.findByRole('button', { name: 'SEY · Hamasho' }));
  const signal = fetcher.mock.calls[1][1].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Choose another coffee' }));
  fireEvent.click(await screen.findByRole('button', { name: 'SEY · Coffee B' }));
  await screen.findByRole('heading', { name: 'Make it yours' });
  await act(async () => resolveA(emptyLatest()));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(/Hamasho/)).not.toBeInTheDocument();
  expect(screen.getByText('SEY · Coffee B')).toBeVisible();
});
it.each(['coffee', 'latest', 'write'])(
  'three-second %s deadline covers body, aborts, ignores late success, and never retries writes',
  async (kind) => {
    let resolve!: (body: unknown) => void;
    const stalled = {
      status: kind === 'write' ? 201 : 200,
      redirected: false,
      json: () =>
        new Promise((done) => {
          resolve = done;
        }),
    };
    let view;
    if (kind === 'write') {
      view = await taste();
      fill('Overall score /100 (required)', '0');
      fetcher.mockResolvedValueOnce(stalled);
      vi.useFakeTimers();
      submit();
    } else if (kind === 'latest') {
      fetcher.mockResolvedValueOnce(page()).mockResolvedValueOnce(stalled);
      view = render(<BrewEntry />);
      const button = await screen.findByRole('button', { name: 'SEY · Hamasho' });
      vi.useFakeTimers();
      fireEvent.click(button);
    } else {
      fetcher.mockResolvedValueOnce(stalled);
      vi.useFakeTimers();
      view = render(<BrewEntry />);
    }
    await act(async () => {
      await Promise.resolve();
    });
    const calls = fetcher.mock.calls.length,
      signal = fetcher.mock.calls.at(-1)![1].signal;
    await act(async () => vi.advanceTimersByTime(3000));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(
      kind === 'write' ? 'may have been saved' : 'could not be loaded',
    );
    await act(async () =>
      resolve(kind === 'coffee' ? await page().json() : await emptyLatest().json()),
    );
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(replace).not.toHaveBeenCalled();
    view.unmount();
  },
);
it('unmount invalidates a pending write and abort-ignoring late 201 cannot navigate', async () => {
  const view = await taste();
  fill('Overall score /100 (required)', '0');
  let resolve!: (response: unknown) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  submit();
  const signal = fetcher.mock.calls.at(-1)![1].signal;
  view.unmount();
  await act(async () => resolve({ status: 201, redirected: false, json: async () => ({}) }));
  expect(signal.aborted).toBe(true);
  expect(replace).not.toHaveBeenCalled();
});
it.each(['malformed', 'mismatch', 'redirect', 'network'])(
  'treats %s write response as uncertain without diagnostics or replay',
  async (fault) => {
    await taste();
    fill('Overall score /100 (required)', '0');
    fetcher.mockImplementationOnce(async () => {
      if (fault === 'network') throw new Error('Private raw fault');
      return {
        status: 201,
        redirected: fault === 'redirect',
        json: async () =>
          fault === 'mismatch'
            ? { brew: { coffeeId: '00000000-0000-4000-8000-000000000002' } }
            : { private: 'Private raw fault' },
      };
    });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    expect(document.body.textContent).not.toContain('Private raw fault');
    expect(replace).not.toHaveBeenCalled();
    submit();
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);
it('requires quarter scores, preserves optional zero/null, and blank overall actions are deliberate', async () => {
  await taste();
  fireEvent.click(screen.getByRole('button', { name: 'Increase overall score' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0.25);
  fill('Overall score /100 (required)', '');
  fireEvent.click(screen.getByRole('button', { name: 'Decrease overall score' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
  fill('Overall score /100 (required)', '87.1');
  submit();
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fill('Overall score /100 (required)', '87.25');
  fireEvent.click(screen.getByRole('button', { name: 'Add Body rating' }));
  fill('Body quality /10', '10.25');
  submit();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
