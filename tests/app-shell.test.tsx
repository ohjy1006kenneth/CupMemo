// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from '../apps/web/src/components/app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/journal',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../apps/web/src/auth/client', () => ({ authClient: { signOut: vi.fn() } }));
afterEach(cleanup);
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
