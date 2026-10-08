// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionView } from '../apps/web/src/components/collection-view';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const empty = { coffees: [], pagination: { limit: 20, offset: 0, hasMore: false } };
const coffee = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Real shelf coffee',
  roaster: 'Real roaster',
  country: null,
  region: null,
  farmStation: null,
  producer: null,
  variety: null,
  process: null,
  elevation: null,
  roastDate: null,
  tastingNotes: [],
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};
const populated = { ...empty, coffees: [coffee] };
const brew = {
  id: coffee.id,
  coffeeId: coffee.id,
  brewer: 'V60',
  grinder: 'Hand grinder',
  grindSetting: '22 clicks',
  doseGrams: 15,
  waterGrams: 250,
  waterTemperatureC: 93,
  totalBrewTimeSeconds: 180,
  brewedAt: coffee.createdAt,
  overallScore: 0,
  tastingMode: 'quick',
  acidity: null,
  body: null,
  aftertaste: null,
  fragranceAroma: null,
  flavor: null,
  balance: null,
  sweetness: null,
  overallImpression: null,
  tastingTags: [],
  notes: null,
  pours: [{ position: 0, waterGrams: 250, startTimeSeconds: 0 }],
  createdAt: coffee.createdAt,
  updatedAt: coffee.updatedAt,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('loads only a fixed private same-origin endpoint and distinguishes a real empty list', async () => {
  fetcher.mockResolvedValue(Response.json(empty));
  render(<CollectionView kind="coffees" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(await screen.findByText('No coffees yet')).toBeVisible();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/coffees?limit=20&offset=0');
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
});
it.each([403, 500, 503])(
  'does not turn HTTP %s into an empty collection and retries without raw errors',
  async (status) => {
    fetcher
      .mockResolvedValueOnce(new Response('private raw error', { status }))
      .mockResolvedValueOnce(Response.json(populated));
    render(<CollectionView kind="coffees" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load');
    expect(screen.queryByText('No coffees yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(coffee.name)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  },
);
it.each([
  {},
  { ...empty, coffees: [{ ...coffee, name: '' }] },
  { ...empty, pagination: { ...empty.pagination, limit: 50 } },
])('rejects malformed or unexpected pages', async (body) => {
  fetcher.mockResolvedValue(Response.json(body));
  render(<CollectionView kind="coffees" />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('No coffees yet')).not.toBeInTheDocument();
});
it('shows real metadata and explicitly identifies the recent twenty boundary', async () => {
  fetcher.mockResolvedValue(
    Response.json({
      ...populated,
      coffees: [
        {
          ...coffee,
          country: 'Ethiopia',
          process: 'Washed',
          roastDate: '2026-10-01',
          tastingNotes: ['Peach'],
        },
      ],
      pagination: { ...empty.pagination, hasMore: true },
    }),
  );
  render(<CollectionView kind="coffees" />);
  expect(await screen.findByText(coffee.name)).toBeVisible();
  expect(screen.getByText('Only the 20 most recent records are shown.')).toBeVisible();
  expect(screen.getByText('Peach')).toBeVisible();
  expect(screen.getByText('Ethiopia · Washed')).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('clears immediately on 401 and uses only the fixed sign-in destination', async () => {
  fetcher.mockResolvedValue(new Response('', { status: 401 }));
  render(<CollectionView kind="coffees" />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
it('uses the independent zero score and clears previous destination rows before a new request finishes', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(populated))
    .mockResolvedValueOnce(Response.json({ brews: [brew], pagination: empty.pagination }));
  const view = render(<CollectionView kind="coffees" />);
  expect(await screen.findByText(coffee.name)).toBeVisible();
  view.rerender(<CollectionView kind="brews" />);
  expect(screen.queryByText(coffee.name)).not.toBeInTheDocument();
  expect(await screen.findByText('V60')).toBeVisible();
  expect(screen.getByText('0.00')).toHaveTextContent('0.00/100');
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/brews?limit=20&offset=0');
});
it.each(['network', 'json', 'redirect'])(
  'keeps %s failure generic and never empty',
  async (fault) => {
    fetcher.mockImplementation(async () => {
      if (fault === 'network') throw new Error('unsafe network details');
      return {
        ok: true,
        status: 200,
        redirected: fault === 'redirect',
        json: async () => {
          throw new Error('unsafe JSON body');
        },
      };
    });
    render(<CollectionView kind="coffees" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load your coffees');
    expect(screen.queryByText('No coffees yet')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('unsafe');
  },
);
it('aborts on unmount and ignores even an abort-ignoring late body', async () => {
  let resolve!: (value: unknown) => void;
  fetcher.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const view = render(<CollectionView kind="coffees" />);
  await waitFor(() => expect(resolve).toBeDefined());
  view.unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    resolve(populated);
  });
  expect(screen.queryByText(coffee.name)).not.toBeInTheDocument();
});
it('bounds body parsing to three seconds, allows retry, and ignores a superseded result', async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  fetcher
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        new Promise((done) => {
          resolve = done;
        }),
    })
    .mockResolvedValueOnce(Response.json(empty));
  render(<CollectionView kind="coffees" />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.getByRole('alert')).toBeVisible();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    resolve(populated);
  });
  expect(screen.getByText('No coffees yet')).toBeVisible();
  expect(screen.queryByText(coffee.name)).not.toBeInTheDocument();
});
