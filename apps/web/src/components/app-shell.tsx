'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Navigation, NavigationLink } from '@cupmemo/ui';
import { SignOutButton } from './sign-out-button';

const destinations = [
  ['/app', 'Beans'],
  ['/app/journal', 'Journal'],
  ['/app/gear', 'Gear'],
] as const;

export function AppShell({ name, children }: { name: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-content">
        Skip to content
      </a>
      <header className="shell-header">
        <a className="brand" href="/app">
          CupMemo
        </a>
        <SignOutButton />
        <p className="shell-greeting">Welcome, {name}</p>
      </header>
      <main id="app-content" tabIndex={-1} className="shell-content">
        {children}
      </main>
      <Navigation aria-label="Primary" className="shell-navigation">
        {destinations.map(([href, label]) => (
          <NavigationLink
            key={href}
            href={href}
            current={
              pathname === href ||
              (href === '/app' && pathname === '/app/coffees/new') ||
              (href === '/app/journal' && pathname === '/app/brews/new')
            }
          >
            {label}
          </NavigationLink>
        ))}
      </Navigation>
    </div>
  );
}
