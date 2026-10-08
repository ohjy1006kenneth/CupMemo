// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CoffeeForm } from '../apps/web/src/components/coffee-form';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetcher = vi.fn();
const minimal = {
  roaster: 'SEY',
  name: 'Hamasho',
  country: null,
  region: null,
  producer: null,
  farmStation: null,
  variety: null,
  process: null,
  elevation: null,
  roastDate: null,
  tastingNotes: [],
};
const coffee = {
  ...minimal,
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'Add coffee to shelf' }).closest('form')!);
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
});
it('starts empty and posts only normalized minimal data, then returns to the real shelf', async () => {
  fetcher.mockResolvedValue(Response.json({ coffee }, { status: 201 }));
  render(<CoffeeForm />);
  expect(screen.getByLabelText('Roaster (required)')).toHaveValue('');
  fill('Roaster (required)', '  SEY  ');
  fill('Coffee name (required)', '  Hamasho  ');
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/coffees');
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(minimal);
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Roaster (required)')).toHaveValue('');
});
it('normalizes every optional field and keeps commas within notes', async () => {
  fetcher.mockResolvedValue(Response.json({ coffee }, { status: 201 }));
  render(<CoffeeForm />);
  fill('Roaster (required)', 'SEY');
  fill('Coffee name (required)', 'Hamasho');
  for (const label of [
    'Country',
    'Region',
    'Producer',
    'Farm / station',
    'Variety',
    'Process',
    'Elevation',
  ])
    fill(`${label} (optional)`, `  ${label}  `);
  fill('Roast date (optional)', '2028-02-29');
  fill('Roaster tasting notes (optional)', ' Peach, citrus \n\n Floral \n');
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    ...minimal,
    country: 'Country',
    region: 'Region',
    producer: 'Producer',
    farmStation: 'Farm / station',
    variety: 'Variety',
    process: 'Process',
    elevation: 'Elevation',
    roastDate: '2028-02-29',
    tastingNotes: ['Peach, citrus', 'Floral'],
  });
});
it.each([
  ['Roaster (required)', '   ', 'roaster'],
  ['Roaster (required)', 'x'.repeat(201), 'roaster'],
  ['Coffee name (required)', '   ', 'name'],
  ['Coffee name (required)', 'x'.repeat(201), 'name'],
  ['Country (optional)', 'x'.repeat(501), 'country'],
  ['Region (optional)', 'x'.repeat(501), 'region'],
  ['Producer (optional)', 'x'.repeat(501), 'producer'],
  ['Farm / station (optional)', 'x'.repeat(501), 'farmStation'],
  ['Variety (optional)', 'x'.repeat(501), 'variety'],
  ['Process (optional)', 'x'.repeat(501), 'process'],
  ['Elevation (optional)', 'x'.repeat(501), 'elevation'],
  ['Roaster tasting notes (optional)', 'Peach\n Peach ', 'tastingNotes'],
  ['Roaster tasting notes (optional)', 'x'.repeat(101), 'tastingNotes'],
  [
    'Roaster tasting notes (optional)',
    Array.from({ length: 33 }, (_, i) => `note${i}`).join('\n'),
    'tastingNotes',
  ],
])('validates %s without a request and retains raw correction values', (label, value, field) => {
  render(<CoffeeForm />);
  fill('Roaster (required)', 'SEY');
  fill('Coffee name (required)', 'Hamasho');
  fill(label, value);
  submit();
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Check');
  expect(document.getElementById(field)).toHaveFocus();
  expect(screen.getByLabelText(label)).toHaveValue(value);
  expect(document.getElementById(field)).toHaveAttribute('aria-invalid', 'true');
});
function ready() {
  const view = render(<CoffeeForm />);
  fill('Roaster (required)', 'SEY');
  fill('Coffee name (required)', 'Hamasho');
  return view;
}
it('accepts exact maxima, blank metadata, case-sensitive descriptors and future leap dates', async () => {
  fetcher.mockResolvedValue(Response.json({ coffee }, { status: 201 }));
  ready();
  fill('Roaster (required)', 'x'.repeat(200));
  fill('Coffee name (required)', 'n'.repeat(200));
  fill('Country (optional)', 'c'.repeat(500));
  fill('Region (optional)', '   ');
  fill('Roast date (optional)', '2028-02-29');
  const notes = [
    'Peach',
    'peach',
    'x'.repeat(100),
    ...Array.from({ length: 29 }, (_, i) => `note${i}`),
  ];
  fill('Roaster tasting notes (optional)', notes.join('\n'));
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    country: 'c'.repeat(500),
    region: null,
    roastDate: '2028-02-29',
    tastingNotes: notes,
  });
});
it.each(['2027-02-29', '2026-04-31'])(
  'refuses an impossible calendar %s even if native sanitization is bypassed',
  (date) => {
    ready();
    const control = screen.getByLabelText('Roast date (optional)');
    control.setAttribute('type', 'text');
    fill('Roast date (optional)', date);
    submit();
    expect(fetcher).not.toHaveBeenCalled();
    expect(control).toHaveFocus();
    expect(screen.getByText('Enter a valid calendar date or leave it empty.')).toBeVisible();
  },
);
it('native invalid feedback focuses the first required input with useful text', () => {
  render(<CoffeeForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Add coffee to shelf' }));
  expect(screen.getByLabelText('Roaster (required)')).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Check');
  expect(fetcher).not.toHaveBeenCalled();
});
it('synchronously guards repeated submissions and makes pending inputs readonly', async () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  ready();
  const form = screen.getByRole('button', { name: 'Add coffee to shelf' }).closest('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: /Adding coffee/ })).toBeDisabled();
  expect(screen.getByLabelText('Roaster (required)')).toHaveAttribute('readonly');
  expect(screen.getByRole('status')).toHaveTextContent('Adding');
});
it.each([400, 403, 413, 415])(
  'retains a declined %s draft and permits deliberate correction',
  async (status) => {
    fetcher
      .mockResolvedValueOnce(new Response('unsafe detail', { status }))
      .mockResolvedValueOnce(Response.json({ coffee }, { status: 201 }));
    ready();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('not added');
    expect(screen.getByLabelText('Roaster (required)')).toHaveValue('SEY');
    expect(document.body.textContent).not.toContain('unsafe');
    fill('Coffee name (required)', 'Corrected');
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it.each([200, 202, 500, 503])(
  'locks an uncertain %s draft instead of resubmitting or claiming success',
  async (status) => {
    fetcher.mockResolvedValue(Response.json({ coffee }, { status }));
    ready();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    expect(screen.getByRole('link', { name: 'Check coffee shelf' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(screen.getByRole('button', { name: 'Add coffee to shelf' })).toBeDisabled();
    submit();
    fill('Coffee name (required)', 'Even edited');
    submit();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  },
);
it.each(['malformed', 'network', 'redirect'])(
  'treats %s as uncertain with no raw diagnostics',
  async (fault) => {
    fetcher.mockImplementation(async () => {
      if (fault === 'network') throw new Error('unsafe network');
      return {
        status: 201,
        redirected: fault === 'redirect',
        json: async () => ({ unsafe: 'raw' }),
      };
    });
    ready();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    expect(document.body.textContent).not.toContain('unsafe');
    expect(replace).not.toHaveBeenCalled();
  },
);
it('clears and hides the draft immediately on real 401 navigation', async () => {
  fetcher.mockResolvedValue(new Response('', { status: 401 }));
  ready();
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Roaster (required)')).not.toBeInTheDocument();
});
it('aborts unmount and ignores abort-ignoring late success', async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = ready();
  submit();
  view.unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    resolve(Response.json({ coffee }, { status: 201 }));
  });
  expect(replace).not.toHaveBeenCalled();
});
it('bounds body parsing to three seconds and ignores late completion without permitting replay', async () => {
  vi.useFakeTimers();
  let resolve!: (body: unknown) => void;
  fetcher.mockResolvedValue({
    status: 201,
    redirected: false,
    json: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  ready();
  submit();
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('may have been saved');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    resolve({ coffee });
  });
  submit();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
});
it('warns only for dirty drafts and respects cancel confirmation', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const view = ready();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard'));
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Roaster (required)')).toHaveValue('SEY');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(replace).toHaveBeenCalledWith('/app');
  view.unmount();
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  confirm.mockRestore();
});
it('pristine cancel requires no dialog and success removes unload protection', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  const view = render(<CoffeeForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).not.toHaveBeenCalled();
  view.unmount();
  replace.mockClear();
  fetcher.mockResolvedValue(Response.json({ coffee }, { status: 201 }));
  ready();
  submit();
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  confirm.mockRestore();
});
it('pending cancel explains that leaving cannot roll back a save', () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  ready();
  submit();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot roll back'));
  expect(replace).not.toHaveBeenCalled();
  confirm.mockRestore();
});
