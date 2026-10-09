// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrewDetail } from '../apps/web/src/components/brew-detail';
const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const brew = {
  id: '00000000-0000-4000-8000-000000000001',
  coffeeId: '00000000-0000-4000-8000-000000000002',
  brewer: 'Custom brewer',
  grinder: 'Hand grinder',
  grindSetting: '22 clicks',
  doseGrams: 15,
  waterGrams: 250,
  waterTemperatureC: 93,
  totalBrewTimeSeconds: 180,
  brewedAt: '2026-10-08T00:00:00.123Z',
  createdAt: '2026-10-08T01:00:00.000Z',
  updatedAt: '2026-10-08T01:00:00.000Z',
  overallScore: 0,
  tastingMode: 'quick',
  acidity: 0,
  body: null,
  aftertaste: null,
  fragranceAroma: null,
  flavor: 8.25,
  balance: null,
  sweetness: null,
  overallImpression: null,
  tastingTags: ['Custom aroma'],
  notes: null,
  pours: [{ position: 0, waterGrams: 250, startTimeSeconds: 0 }],
};
const coffee = {
  id: brew.coffeeId,
  name: 'Actual coffee',
  roaster: 'Actual roaster',
  country: null,
  region: null,
  farmStation: null,
  producer: null,
  variety: null,
  process: null,
  elevation: null,
  roastDate: null,
  tastingNotes: [],
  createdAt: brew.createdAt,
  updatedAt: brew.updatedAt,
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
});
it('reads exact bound brew and coffee, with actual recipe and independent retained quick qualities', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ brew }))
    .mockResolvedValueOnce(Response.json({ coffee }));
  render(<BrewDetail id={brew.id} />);
  expect(await screen.findByText('Actual coffee')).toBeVisible();
  expect(screen.getByText('Actual roaster')).toBeVisible();
  expect(screen.getByText('Custom brewer')).toBeVisible();
  expect(screen.getByText('22 clicks')).toBeVisible();
  expect(screen.getByText('0.00 /100')).toBeVisible();
  expect(screen.getByText('8.25 /10')).toBeVisible();
  expect(screen.getAllByText('Not rated')).toHaveLength(6);
  expect(screen.getByText('No tasting notes')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Edit brew' })).toHaveAttribute(
    'href',
    `/app/brews/${brew.id}/tasting`,
  );
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    `/api/v1/brews/${brew.id}`,
    `/api/v1/coffees/${brew.coffeeId}`,
  ]);
});

it('invalid route identity performs no lookup or reflection', () => {
  render(<BrewDetail id="private-untrusted-invalid-id" />);
  expect(screen.getByRole('alert')).toHaveTextContent('This brew is unavailable.');
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByText('private-untrusted-invalid-id')).not.toBeInTheDocument();
});
it('mismatched brew identity is a retry error and never requests coffee', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ brew: { ...brew, id: brew.coffeeId } }));
  render(<BrewDetail id={brew.id} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByText('Custom brewer')).not.toBeInTheDocument();
});
it('coffee binding failure preserves validated recipe and separately retries real context', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ brew }))
    .mockResolvedValueOnce(Response.json({ coffee: { ...coffee, id: brew.id } }))
    .mockResolvedValueOnce(Response.json({ coffee }));
  render(<BrewDetail id={brew.id} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Coffee context is unavailable.');
  expect(screen.getByText('Custom brewer')).toBeVisible();
  expect(screen.queryByText('Actual coffee')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry coffee context' }));
  expect(await screen.findByText('Actual coffee')).toBeVisible();
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    `/api/v1/brews/${brew.id}`,
    `/api/v1/coffees/${brew.coffeeId}`,
    `/api/v1/coffees/${brew.coffeeId}`,
  ]);
});
it.each(['brew', 'coffee'])(
  '%s 401 hides all private context and refreshes fixed signin',
  async (target) => {
    if (target === 'coffee') fetcher.mockResolvedValueOnce(Response.json({ brew }));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(<BrewDetail id={brew.id} />);
    await act(async () => {});
    expect(replace).toHaveBeenCalledWith('/sign-in');
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText('Custom brewer')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit brew' })).not.toBeInTheDocument();
  },
);
it('keyed identity and body deadlines invalidate abort-ignoring late brew', async () => {
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
  const view = render(<BrewDetail id={brew.id} />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  const next = { ...brew, id: brew.coffeeId, brewer: 'Next brew' };
  fetcher
    .mockResolvedValueOnce(Response.json({ brew: next }))
    .mockResolvedValueOnce(Response.json({ coffee }));
  view.rerender(<BrewDetail id={next.id} />);
  await act(async () => {});
  await act(async () => release({ brew }));
  expect(screen.queryByText('Custom brewer')).not.toBeInTheDocument();
  expect(screen.getByText('Next brew')).toBeVisible();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
