// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionView } from '../apps/web/src/components/collection-view';
const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const brew = {
  id: '00000000-0000-4000-8000-000000000001',
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
  tastingTags: [],
  notes: null,
  pours: [{ position: 0, waterGrams: 250, startTimeSeconds: 0 }],
};
const page = (offset: number, brews = [brew], hasMore = false) => ({
  brews,
  pagination: { limit: 20, offset, hasMore },
});
beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('Journal pages real records, clears synchronously and offers Previous on a later empty page', async () => {
  fetcher.mockResolvedValueOnce(Response.json(page(0, [brew], true)));
  render(<CollectionView kind="brews" />);
  expect(await screen.findByRole('link', { name: /View brew.*V60/ })).toHaveAttribute(
    'href',
    `/app/brews/${brew.id}`,
  );
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  let resolve!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByText('V60')).not.toBeInTheDocument();
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/brews?limit=20&offset=20');
  await act(async () => resolve(Response.json(page(20, []))));
  expect(screen.getByText('No brews on this page.')).toBeVisible();
  expect(screen.queryByText('No brews yet')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it.each([
  ['wrong offset', page(20)],
  ['wrong limit', { ...page(0), pagination: { limit: 10, offset: 0, hasMore: false } }],
  ['duplicates', page(0, [brew, brew])],
  [
    'oversized',
    page(
      0,
      Array.from({ length: 21 }, () => brew),
    ),
  ],
  ['malformed', { brews: [] }],
])('Journal refuses %s rather than displaying empty or unvalidated records', async (_, body) => {
  fetcher.mockResolvedValueOnce(Response.json(body));
  render(<CollectionView kind="brews" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t load');
  expect(screen.queryByText('No brews yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /View brew/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
it('initial empty history has an ordinary real record action and no fictional count', async () => {
  fetcher.mockResolvedValueOnce(Response.json(page(0, [])));
  render(<CollectionView kind="brews" />);
  expect(await screen.findByText('No brews yet')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Record a brew' })).toHaveAttribute(
    'href',
    '/app/brews/new',
  );
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
it('history body deadline ignores late page completion and retries only on deliberate action', async () => {
  vi.useFakeTimers();
  let release!: (body: unknown) => void;
  fetcher.mockResolvedValueOnce({
    status: 200,
    redirected: false,
    json: () =>
      new Promise((done) => {
        release = done;
      }),
  });
  render(<CollectionView kind="brews" />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('alert')).toHaveTextContent('couldn’t load');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => release(page(0)));
  expect(screen.queryByText('V60')).not.toBeInTheDocument();
  fetcher.mockResolvedValueOnce(Response.json(page(0)));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await act(async () => {});
  expect(screen.getByText('V60')).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('history clears all rows on a paged 401 and fixed signin refresh', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(page(0, [brew], true)))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  render(<CollectionView kind="brews" />);
  await screen.findByText('V60');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => {});
  expect(replace).toHaveBeenCalledWith('/sign-in');
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByText('V60')).not.toBeInTheDocument();
});
