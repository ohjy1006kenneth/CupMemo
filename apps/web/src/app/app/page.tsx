import { redirect } from 'next/navigation';
import { currentAuthSession } from '../../auth/session';
import { SignOutButton } from '../../components/sign-out-button';
import { AccountSession } from '../../components/account-session';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
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
      <main className="account-page">
        <header className="account-header">
          <a className="brand" href="/app">
            CupMemo
          </a>
          <SignOutButton />
        </header>
        <section className="account-card" aria-labelledby="account-title">
          <p className="eyebrow">Your account</p>
          <h1 id="account-title">Welcome, {result.session.user.name}</h1>
          <p className="auth-intro">
            Your account is ready. Brew journaling features are not available yet.
          </p>
        </section>
      </main>
    </AccountSession>
  );
}
