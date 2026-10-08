import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentAuthSession } from '../../auth/session';
import { AccountSession } from '../../components/account-session';
import { AppShell } from '../../components/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = await currentAuthSession();
  if (result.kind === 'unauthenticated') redirect('/sign-in');
  if (result.kind === 'unavailable') {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="unavailable-title">
          <h1 id="unavailable-title">We can’t reach your account right now.</h1>
          <p className="auth-intro">Your session couldn’t be checked. Please retry in a moment.</p>
          <a className="primary-button button-link" href="/app">
            Try again
          </a>
        </section>
      </main>
    );
  }
  return (
    <AccountSession>
      <AppShell name={result.session.user.name}>{children}</AppShell>
    </AccountSession>
  );
}
