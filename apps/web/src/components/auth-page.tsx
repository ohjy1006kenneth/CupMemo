import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentAuthSession } from '../auth/session';
import { AuthForm } from './auth-form';

type AuthPageProps = { mode: 'sign-in' | 'sign-up' };

export async function AuthPage({ mode }: AuthPageProps) {
  const result = await currentAuthSession();
  if (result.kind === 'authenticated') redirect('/app');
  if (result.kind === 'unavailable') return <Unavailable />;
  const signingUp = mode === 'sign-up';

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="brand" href="/" aria-label="CupMemo home">
          CupMemo
        </Link>
        <p className="eyebrow">Your brewing journal</p>
        <h1 id="auth-title">{signingUp ? 'Make room for better brews.' : 'Welcome back.'}</h1>
        <p className="auth-intro">
          {signingUp
            ? 'Create your account to get started with CupMemo.'
            : 'Sign in to continue to CupMemo.'}
        </p>
        <AuthForm mode={mode} />
        {signingUp && (
          <p className="account-note">Email verification is not required at this time.</p>
        )}
      </section>
    </main>
  );
}

function Unavailable() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="unavailable-title">
        <Link className="brand" href="/">
          CupMemo
        </Link>
        <h1 id="unavailable-title">We can’t reach your account right now.</h1>
        <p className="auth-intro">Your session couldn’t be checked. Please retry in a moment.</p>
        <a className="primary-button button-link" href="">
          Try again
        </a>
      </section>
    </main>
  );
}
