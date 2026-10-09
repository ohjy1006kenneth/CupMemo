// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionView } from '../apps/web/src/components/collection-view';
import { SavedTastingEntry } from '../apps/web/src/components/saved-tasting-entry';
import {
  assessmentFromBrew,
  parseAssessmentPatch,
  qualities,
} from '../apps/web/src/components/brew-draft';
import type { Brew } from '@cupmemo/contracts';
const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const id = '00000000-0000-4000-8000-000000000001';
const original = {
  id,
  coffeeId: '00000000-0000-4000-8000-000000000002',
  brewer: 'V60',
  grinder: 'Hand grinder',
  grindSetting: '22 clicks',
  doseGrams: 15,
  waterGrams: 250,
  waterTemperatureC: 93,
  totalBrewTimeSeconds: 180,
  brewedAt: '2026-10-08T00:00:00.000Z',
  createdAt: '2026-10-08T01:00:00.000Z',
  updatedAt: '2026-10-08T01:00:00.000Z',
  overallScore: 0,
  tastingMode: 'quick',
  acidity: 0,
  body: null,
  aftertaste: null,
  fragranceAroma: null,
  flavor: null,
  balance: null,
  sweetness: null,
  overallImpression: null,
  tastingTags: ['Custom aroma', 'Peach'],
  notes: 'Original notes',
  pours: [{ position: 0, waterGrams: 250, startTimeSeconds: 0 }],
};
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
it('Journal opens a real saved tasting, no-op does not write, and changed-only PATCH preserves identity with concurrent recipe', async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({ brews: [original], pagination: { limit: 20, offset: 0, hasMore: false } }),
  );
  const journal = render(<CollectionView kind="brews" />);
  const link = await screen.findByRole('link', { name: /Edit tasting.*V60/ });
  expect(link).toHaveAttribute('href', `/app/brews/${id}/tasting`);
  journal.unmount();

  fetcher.mockResolvedValueOnce(Response.json({ brew: original }));
  render(<SavedTastingEntry id={id} />);
  await screen.findByRole('button', { name: 'Save changes' });
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
  expect(screen.getByRole('button', { name: 'Custom aroma' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const pristine = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(pristine);
  expect(pristine.defaultPrevented).toBe(false);
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);
  expect(await screen.findByText('No changes to save.')).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Sensory Detail' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Fragrance/Aroma rating' }));
  fireEvent.change(screen.getByLabelText('Fragrance/Aroma quality /10'), {
    target: { value: '8.25' },
  });
  let resolve!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url, options] = fetcher.mock.calls[2];
  expect(url).toBe(`/api/v1/brews/${id}`);
  expect(options).toMatchObject({
    method: 'PATCH',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
  expect(JSON.parse(options.body)).toEqual({ tastingMode: 'sensory', fragranceAroma: 8.25 });
  expect(screen.getByRole('button', { name: 'Saving changes…' })).toBeDisabled();
  await act(async () =>
    resolve(
      Response.json({
        brew: { ...original, tastingMode: 'sensory', fragranceAroma: 8.25, waterTemperatureC: 95 },
      }),
    ),
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/journal'));
  expect(refresh).toHaveBeenCalledOnce();
  const saved = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);
});
async function readySaved() {
  fetcher.mockResolvedValueOnce(Response.json({ brew: original }));
  const view = render(<SavedTastingEntry id={id} />);
  await screen.findByRole('button', { name: 'Save changes' });
  return view;
}
function changeScore(value = '88.25') {
  fireEvent.change(screen.getByLabelText('Overall score /100 (required)'), { target: { value } });
}
function saveChanges() {
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);
}
it('normalizes tag sets and notes without rewriting untouched fields; null/zero clears never include recipe', () => {
  const brew = original as Brew;
  const a = assessmentFromBrew(brew);
  a.tastingTags.reverse();
  a.notes = '  Original notes  ';
  a.overallScore = '0.00';
  expect(parseAssessmentPatch(brew, a)).toMatchObject({ success: true, data: null });
  a.acidity = null;
  a.balance = '0';
  a.notes = ' ';
  a.tastingTags = [];
  expect(parseAssessmentPatch(brew, a)).toMatchObject({
    success: true,
    data: { acidity: null, balance: 0, notes: null, tastingTags: [] },
  });
  expect(brew).toEqual(original);
});
it.each(qualities)(
  'saved %s retains invalid hidden text and validates all nullable quarters',
  (key) => {
    for (const value of ['', '-1', '10.25', '8.1', 'NaN', 'Infinity']) {
      const a = assessmentFromBrew(original as Brew);
      a[key] = value;
      expect(parseAssessmentPatch(original as Brew, a).success).toBe(false);
      expect(a[key]).toBe(value);
    }
    for (const value of [null, '0', '10', '8.25']) {
      const a = assessmentFromBrew(original as Brew);
      a[key] = value;
      expect(parseAssessmentPatch(original as Brew, a).success).toBe(true);
    }
  },
);
it('saved hidden invalid validation expands and focuses after mount with retained custom tags', async () => {
  await readySaved();
  fireEvent.click(screen.getByRole('button', { name: 'Sensory Detail' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Flavor rating' }));
  fireEvent.change(screen.getByLabelText('Flavor quality /10'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quick rating' }));
  saveChanges();
  await waitFor(() => expect(screen.getByLabelText('Flavor quality /10')).toHaveFocus());
  expect(screen.getByLabelText('Flavor quality /10')).toHaveValue(null);
  expect(screen.getByRole('button', { name: 'Custom aroma' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
it('invalid IDs never look up and missing/foreign 404 are unavailable without edit or retry', async () => {
  const invalid = render(<SavedTastingEntry id="private/raw" />);
  expect(screen.getByRole('alert')).toHaveTextContent('This tasting is unavailable.');
  expect(fetcher).not.toHaveBeenCalled();
  invalid.unmount();
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
  render(<SavedTastingEntry id={id} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This tasting is unavailable.');
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry tasting' })).not.toBeInTheDocument();
});
it.each([401, 404])(
  'PATCH %s terminally clears private values with no resubmit',
  async (status) => {
    await readySaved();
    changeScore();
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    saveChanges();
    await waitFor(() =>
      expect(screen.queryByLabelText('Overall score /100 (required)')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('Original notes')).not.toBeInTheDocument();
    if (status === 401) {
      expect(replace).toHaveBeenCalledWith('/sign-in');
      expect(refresh).toHaveBeenCalledOnce();
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent('This tasting is unavailable.');
      expect(replace).not.toHaveBeenCalled();
    }
  },
);
it.each([400, 403, 413, 415])(
  'PATCH declined %s retains draft and deliberately allows corrected submit',
  async (status) => {
    await readySaved();
    changeScore();
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    saveChanges();
    expect(await screen.findByRole('alert')).toHaveTextContent('were not saved');
    expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(88.25);
    changeScore('89');
    fetcher.mockResolvedValueOnce(Response.json({ brew: { ...original, overallScore: 89 } }));
    saveChanges();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/journal'));
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);
it.each([
  () => new Response(null, { status: 500 }),
  () => new Response(null, { status: 201 }),
  () => Response.json({}),
  () => Response.json({ brew: { ...original, id: original.coffeeId, overallScore: 88.25 } }),
  () => Response.json({ brew: { ...original, coffeeId: id, overallScore: 88.25 } }),
  () => Response.json({ brew: { ...original, createdAt: original.brewedAt, overallScore: 88.25 } }),
  () => Response.json({ brew: original }),
  () => ({ status: 200, redirected: true, json: async () => ({ brew: original }) }),
])(
  'uncertain PATCH permanently locks even after edits and never reconciles/replays',
  async (response) => {
    await readySaved();
    changeScore();
    fetcher.mockResolvedValueOnce(response());
    saveChanges();
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been updated');
    expect(screen.getByRole('link', { name: 'Check journal' })).toHaveAttribute(
      'href',
      '/app/journal',
    );
    changeScore('90');
    saveChanges();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    const warn = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warn);
    expect(warn.defaultPrevented).toBe(true);
  },
);
it('dirty cancel refusal retains values and accepted cancel discards without PATCH and cleans unload', async () => {
  await readySaved();
  changeScore();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(88.25);
  expect(replace).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
  expect(replace).toHaveBeenCalledWith('/app/journal');
  expect(fetcher).toHaveBeenCalledOnce();
  const warn = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(warn);
  expect(warn.defaultPrevented).toBe(false);
});
it('GET 401 hides private data and fixed-signin refreshes', async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  render(<SavedTastingEntry id={id} />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Tasting notes (optional)')).not.toBeInTheDocument();
});
it('GET body deadline includes abort-ignoring late completion; retry validates and old route cannot display/save', async () => {
  vi.useFakeTimers();
  let resolveBody!: (body: unknown) => void;
  fetcher.mockResolvedValueOnce({
    status: 200,
    redirected: false,
    json: () =>
      new Promise((done) => {
        resolveBody = done;
      }),
  });
  const view = render(<SavedTastingEntry id={id} />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button', { name: 'Retry tasting' })).toBeVisible();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ brew: original }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry tasting' })));
  await act(async () => resolveBody({ brew: { ...original, overallScore: 99 } }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
  let resolveOld!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolveOld = done;
      }),
  );
  view.rerender(<SavedTastingEntry id={original.coffeeId} />);
  expect(screen.queryByLabelText('Overall score /100 (required)')).not.toBeInTheDocument();
  view.unmount();
  await act(async () =>
    resolveOld(Response.json({ brew: { ...original, id: original.coffeeId } })),
  );
  expect(replace).not.toHaveBeenCalled();
});
it('PATCH body deadline and unmount prevent late success and never resend uncertain write', async () => {
  const view = await readySaved();
  vi.useFakeTimers();
  changeScore();
  let resolveBody!: (body: unknown) => void;
  fetcher.mockResolvedValueOnce({
    status: 200,
    redirected: false,
    json: () =>
      new Promise((done) => {
        resolveBody = done;
      }),
  });
  await act(async () => saveChanges());
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('alert')).toHaveTextContent('may have been updated');
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => resolveBody({ brew: { ...original, overallScore: 88.25 } }));
  expect(replace).not.toHaveBeenCalled();
  view.unmount();
  const warn = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(warn);
  expect(warn.defaultPrevented).toBe(false);
});
