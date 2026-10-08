// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSession } from '../apps/web/src/components/account-session';
import { CollectionView } from '../apps/web/src/components/collection-view';
import AppLayout from '../apps/web/src/app/app/layout';
import BeansPage from '../apps/web/src/app/app/page';
import GearPage from '../apps/web/src/app/app/gear/page';

const { replace, refresh, redirect, authority, mounted, refetch } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('fixed redirect');
  }),
  authority: vi.fn(),
  mounted: vi.fn(),
  refetch: vi.fn(),
}));
const router = { replace, refresh };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/app',
  redirect,
}));
vi.mock('../apps/web/src/auth/session', () => ({ currentAuthSession: authority }));
vi.mock('../apps/web/src/auth/client', () => ({
  authClient: { useSession: mounted, signOut: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mounted.mockReturnValue({ data: {}, error: null, isPending: false, refetch });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(['unauthenticated', 'unavailable'])(
  'the shared server layout fails closed on %s',
  async (kind) => {
    authority.mockResolvedValue({ kind });
    if (kind === 'unauthenticated') {
      await expect(AppLayout({ children: <p>private</p> })).rejects.toThrow('fixed redirect');
      expect(redirect).toHaveBeenCalledWith('/sign-in');
    } else {
      render(await AppLayout({ children: <p>private</p> }));
      expect(screen.queryByText('private')).not.toBeInTheDocument();
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/app');
    }
  },
);
it('freshness pending/error/null suppresses all shell children and prevents collection requests', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ coffees: [], pagination: { limit: 20, offset: 0, hasMore: false } }),
    );
  vi.stubGlobal('fetch', fetcher);
  mounted.mockReturnValue({ data: null, error: null, isPending: true, refetch });
  const content = (
    <AccountSession>
      <CollectionView kind="coffees" />
    </AccountSession>
  );
  const view = render(content);
  expect(fetcher).not.toHaveBeenCalled();
  mounted.mockReturnValue({ data: {}, error: null, isPending: false, refetch });
  view.rerender(
    <AccountSession>
      <CollectionView kind="coffees" />
    </AccountSession>,
  );
  expect(await screen.findByText('No coffees yet')).toBeVisible();
  mounted.mockReturnValue({ data: {}, error: {}, isPending: false, refetch });
  view.rerender(
    <AccountSession>
      <CollectionView kind="coffees" />
    </AccountSession>,
  );
  expect(screen.queryByText('No coffees yet')).not.toBeInTheDocument();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  mounted.mockReturnValue({ data: null, error: null, isPending: false, refetch });
  view.rerender(
    <AccountSession>
      <CollectionView kind="coffees" />
    </AccountSession>,
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  expect(fetcher).toHaveBeenCalledOnce();
});
it('renders only the approved disabled brew and honest Gear boundary', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  const view = render(<BeansPage />);
  expect(screen.getByRole('button', { name: 'Record a brew' })).toBeDisabled();
  expect(screen.getByText('Brew recording will be available in the next delivery.')).toBeVisible();
  view.unmount();
  render(<GearPage />);
  expect(screen.getByRole('heading', { name: 'Your daily setup' })).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
