// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SavedTastingEntry } from '../apps/web/src/components/saved-tasting-entry';
import {
  savedDraft,
  parseSavedPatch,
  patchMatches,
  localToUTC,
} from '../apps/web/src/components/brew-draft';
import type { Brew } from '@cupmemo/contracts';
import process from 'node:process';
const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const original = {
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
it('saved recipe and tasting share one draft and either panel saves only changed fields, retaining exact milliseconds and accepting omitted concurrent assessment', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ brew: original }));
  render(<SavedTastingEntry id={original.id} />);
  await screen.findByRole('button', { name: 'Save changes' });
  fireEvent.click(screen.getByRole('button', { name: 'Recipe', exact: true }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit your brew');
  expect(screen.getByLabelText('Other brewer (required)')).toHaveValue('Custom brewer');
  expect(screen.getByLabelText('Grind setting (required)')).toHaveValue('22 clicks');
  fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tasting', exact: true }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveValue(0);
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValueOnce(
    Response.json({ brew: { ...original, waterTemperatureC: 94, notes: 'Concurrent notes' } }),
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/journal'));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ waterTemperatureC: 94 });
  expect(refresh).toHaveBeenCalledOnce();
});
it('full draft normalization projects pours, preserves milliseconds/noop and validates merged water before request', () => {
  const b = original as Brew;
  const d = savedDraft(b);
  d.recipe.doseGrams = '15.00';
  d.recipe.brewer = ' Custom brewer ';
  d.assessment.notes = ' Original notes ';
  d.assessment.tastingTags.reverse();
  expect(parseSavedPatch(b, d)).toEqual({ success: true, data: null });
  d.recipe.waterTemperatureC = '94';
  d.assessment.overallScore = '88.25';
  expect(parseSavedPatch(b, d)).toMatchObject({
    success: true,
    data: { waterTemperatureC: 94, overallScore: 88.25 },
  });
  d.recipe.waterGrams = '255';
  expect(parseSavedPatch(b, d).success).toBe(false);
  d.recipe.pours[0].waterGrams = '255';
  const delta = parseSavedPatch(b, d);
  expect(delta).toMatchObject({
    success: true,
    data: { waterGrams: 255, pours: [{ waterGrams: 255, startTimeSeconds: 0 }] },
  });
  if (delta.success && delta.data) {
    expect(
      patchMatches(
        b,
        {
          ...b,
          ...delta.data,
          notes: 'Concurrent notes',
          pours: [{ position: 0, waterGrams: 255, startTimeSeconds: 0 }],
        } as Brew,
        delta.data,
      ),
    ).toBe(true);
    expect(patchMatches(b, b, delta.data)).toBe(false);
  }
  expect(b.brewedAt).toBe('2026-10-08T00:00:00.123Z');
  d.localTime = '2026-10-09T12:34:56';
  expect(parseSavedPatch(b, d)).toMatchObject({
    success: true,
    data: { brewedAt: localToUTC(d.localTime) },
  });
});
async function ready() {
  fetcher.mockResolvedValueOnce(Response.json({ brew: original }));
  render(<SavedTastingEntry id={original.id} />);
  await screen.findByRole('button', { name: 'Save changes' });
}
const tab = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const save = () =>
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);
it('both invalid panels retain raw text and focus hidden recipe then hidden sensory fields without writing', async () => {
  await ready();
  tab('Recipe');
  fireEvent.change(screen.getByLabelText('Water (g)'), { target: { value: '255' } });
  tab('Tasting');
  save();
  await waitFor(() => expect(screen.getByLabelText('Water (g)')).toHaveFocus());
  expect(screen.getByLabelText('Water (g)')).toHaveValue(255);
  fireEvent.change(screen.getByLabelText('Water (g)'), { target: { value: '250' } });
  tab('Tasting');
  tab('Sensory Detail');
  tab('Add Flavor rating');
  fireEvent.change(screen.getByLabelText('Flavor quality /10'), { target: { value: '' } });
  tab('Quick rating');
  tab('Recipe');
  save();
  await waitFor(() => expect(screen.getByLabelText('Flavor quality /10')).toHaveFocus());
  expect(screen.getByLabelText('Flavor quality /10')).toHaveValue(null);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('recipe save includes tasting changes, disables every pending control and double submission writes once', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Overall score /100 (required)'), {
    target: { value: '88.25' },
  });
  tab('Recipe');
  fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
  let resolve!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    save();
    save();
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    waterTemperatureC: 94,
    overallScore: 88.25,
  });
  expect(screen.getByLabelText('Temperature (°C)')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Tasting', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Scale target' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel changes' })).toBeEnabled();
  await act(async () =>
    resolve(Response.json({ brew: { ...original, waterTemperatureC: 94, overallScore: 88.25 } })),
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/journal'));
});
it('dirty recipe cancellation refusal preserves both drafts; accepted discard never writes', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Tasting notes (optional)'), {
    target: { value: 'Draft notes' },
  });
  tab('Recipe');
  fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  tab('Cancel changes');
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Temperature (°C)')).toHaveValue(94);
  tab('Tasting');
  expect(screen.getByLabelText('Tasting notes (optional)')).toHaveValue('Draft notes');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  tab('Cancel changes');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledWith('/app/journal');
});

it('later DST-overlap original remains exact on a no-op and recipe-only delta', () => {
  const timezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const b = { ...original, brewedAt: '2026-11-01T06:30:00.789Z' } as Brew;
    const d = savedDraft(b);
    expect(d.localTime).toBe('2026-11-01T01:30:00');
    expect(localToUTC(d.localTime)).toBe('2026-11-01T05:30:00.000Z');
    expect(parseSavedPatch(b, d)).toEqual({ success: true, data: null });
    d.recipe.waterTemperatureC = '94';
    expect(parseSavedPatch(b, d)).toEqual({ success: true, data: { waterTemperatureC: 94 } });
  } finally {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  }
});
it.each([400, 403, 413, 415])(
  'recipe %s decline retains both panels and allows corrected explicit submit',
  async (status) => {
    await ready();
    tab('Recipe');
    fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    save();
    await screen.findByText(/These changes were not saved/);
    expect(screen.getByLabelText('Temperature (°C)')).toHaveValue(94);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    tab('Tasting');
    fireEvent.change(screen.getByLabelText('Overall score /100 (required)'), {
      target: { value: '88.25' },
    });
    fetcher.mockResolvedValueOnce(
      Response.json({ brew: { ...original, waterTemperatureC: 94, overallScore: 88.25 } }),
    );
    save();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/journal'));
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      waterTemperatureC: 94,
      overallScore: 88.25,
    });
  },
);
it('recipe PATCH body deadline permanently locks both panels and ignores late success', async () => {
  await ready();
  vi.useFakeTimers();
  tab('Recipe');
  fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
  let release!: (body: unknown) => void;
  fetcher.mockResolvedValueOnce({
    status: 200,
    redirected: false,
    json: () =>
      new Promise((done) => {
        release = done;
      }),
  });
  save();
  await act(async () => {});
  expect(screen.getByLabelText('Temperature (°C)')).toBeDisabled();
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText(/This tasting may have been updated/)).toBeVisible();
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => release({ brew: { ...original, waterTemperatureC: 94 } }));
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '95' } });
  save();
  tab('Tasting');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  save();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: 'Check journal' })).toHaveAttribute(
    'href',
    '/app/journal',
  );
});
it.each([401, 404])(
  'recipe PATCH%s terminally clears both panels without retry',
  async (status) => {
    await ready();
    tab('Recipe');
    fireEvent.change(screen.getByLabelText('Temperature (°C)'), { target: { value: '94' } });
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    save();
    await act(async () => {});
    expect(screen.queryByLabelText('Temperature (°C)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry tasting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    if (status === 401) expect(replace).toHaveBeenCalledWith('/sign-in');
    else expect(screen.getByRole('alert')).toHaveTextContent('This tasting is unavailable.');
  },
);
