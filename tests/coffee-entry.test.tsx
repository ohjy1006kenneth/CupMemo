// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BeansPage from '../apps/web/src/app/app/page';
import { AppShell } from '../apps/web/src/components/app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/coffees/new',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../apps/web/src/auth/client', () => ({ authClient: { signOut: vi.fn() } }));
vi.mock('../apps/web/src/components/collection-view', () => ({
  CollectionView: () => <p>No coffees yet</p>,
}));
afterEach(cleanup);
it('offers one ordinary coffee entry anchor with Beans current on the new route', () => {
  render(
    <AppShell name="Jamie">
      <BeansPage />
    </AppShell>,
  );
  expect(screen.getByRole('link', { name: 'Add coffee' })).toHaveAttribute(
    'href',
    '/app/coffees/new',
  );
  expect(screen.getByRole('link', { name: 'Beans' })).toHaveAttribute('aria-current', 'page');
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Record a brew' })).toBeDisabled();
});
