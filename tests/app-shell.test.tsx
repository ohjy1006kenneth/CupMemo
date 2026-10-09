// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from '../apps/web/src/components/app-shell';

const state = vi.hoisted(() => ({ pathname: '/app/journal' }));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../apps/web/src/auth/client', () => ({ authClient: { signOut: vi.fn() } }));
afterEach(cleanup);
it('marks only validated UUID tasting routes current in Journal', () => {
  for (const [pathname, current] of [
    ['/app/brews/00000000-0000-4000-8000-000000000001/tasting', true],
    ['/app/brews/not-a-uuid/tasting', false],
    ['/app/brews/00000000-0000-4000-8000-000000000001/tasting/other', false],
  ] as const) {
    state.pathname = pathname;
    const view = render(
      <AppShell name="Jamie">
        <h1>Edit your tasting</h1>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Journal' }).hasAttribute('aria-current')).toBe(
      current,
    );
    view.unmount();
  }
  state.pathname = '/app/journal';
});
it('provides ordinary ordered destinations with exactly one current page and a skip target', () => {
  render(
    <AppShell name="Jamie">
      <h1>Brew, learn, repeat</h1>
    </AppShell>,
  );
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const links = Array.from(nav.querySelectorAll('a'));
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Beans', '/app'],
    ['Journal', '/app/journal'],
    ['Gear', '/app/gear'],
  ]);
  expect(links.filter((link) => link.hasAttribute('aria-current'))).toEqual([links[1]]);
  expect(links[1]).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
    'href',
    '#app-content',
  );
  expect(screen.getByRole('main')).toHaveAttribute('id', 'app-content');
  expect(screen.getByText('Welcome, Jamie')).toBeVisible();
});
it('marks Journal current on exactly the protected new-brew route, not invented descendants', () => {
  for (const pathname of ['/app/brews/new', '/app/brews/new/unknown']) {
    state.pathname = pathname;
    const view = render(
      <AppShell name="Jamie">
        <h1>Choose a coffee</h1>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Journal' }).hasAttribute('aria-current')).toBe(
      pathname === '/app/brews/new',
    );
    view.unmount();
  }
  state.pathname = '/app/journal';
});
