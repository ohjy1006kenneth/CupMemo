// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSession } from '../apps/web/src/components/account-session';
import { BrewEntry } from '../apps/web/src/components/brew-entry';
const { mounted, replace, refresh } = vi.hoisted(() => ({
  mounted: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../apps/web/src/auth/client', () => ({ authClient: { useSession: mounted } }));
const fetcher = vi.fn(),
  refetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(['pending', 'error', 'null'])(
  'auth boundary %s removes brew requests/data and abort-ignoring late results cannot restore them',
  async (state) => {
    let resolve!: (body: unknown) => void;
    fetcher.mockResolvedValue({
      status: 200,
      redirected: false,
      json: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    mounted.mockReturnValue({ data: null, isPending: true, error: null, refetch });
    const view = render(
      <AccountSession>
        <BrewEntry />
      </AccountSession>,
    );
    expect(fetcher).not.toHaveBeenCalled();
    mounted.mockReturnValue({ data: {}, isPending: false, error: null, refetch });
    view.rerender(
      <AccountSession>
        <BrewEntry />
      </AccountSession>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const signal = fetcher.mock.calls[0][1].signal;
    mounted.mockReturnValue({
      data: state === 'null' ? null : {},
      isPending: state === 'pending',
      error: state === 'error' ? {} : null,
      refetch,
    });
    view.rerender(
      <AccountSession>
        <BrewEntry />
      </AccountSession>,
    );
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Choose a coffee' })).not.toBeInTheDocument();
    await act(async () =>
      resolve({ coffees: [], pagination: { limit: 20, offset: 0, hasMore: false } }),
    );
    expect(screen.queryByText('No coffees yet')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent(window, new Event('beforeunload', { cancelable: true }));
  },
);
