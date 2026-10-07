'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '../auth/client';

// Server validation remains the authorization gate. This mounted official client
// receives renewal cookies and suppresses stale account UI after revocation.
export function AccountSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, error, isPending, refetch } = authClient.useSession();
  useEffect(() => {
    if (!isPending && !error && !data) {
      router.replace('/sign-in');
      router.refresh();
    }
  }, [data, error, isPending, router]);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void refetch();
        router.refresh();
      }
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [refetch, router]);
  if (error) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="client-unavailable-title">
          <h1 id="client-unavailable-title">We can’t reach your account right now.</h1>
          <p className="auth-intro">Your session couldn’t be checked. Please retry in a moment.</p>
          <a className="primary-button button-link" href="/app">
            Try again
          </a>
        </section>
      </main>
    );
  }
  if (isPending || !data)
    return (
      <p className="auth-page" role="status">
        Checking your account…
      </p>
    );
  return children;
}
