import { redirect } from 'next/navigation';
import { currentAuthSession } from '../auth/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const result = await currentAuthSession();
  if (result.kind === 'authenticated') redirect('/app');
  if (result.kind === 'unauthenticated') redirect('/sign-in');
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="unavailable-title">
        <a className="brand" href="/">
          CupMemo
        </a>
        <h1 id="unavailable-title">We can’t reach your account right now.</h1>
        <p className="auth-intro">Your session couldn’t be checked. Please retry in a moment.</p>
        <a className="primary-button button-link" href="/">
          Try again
        </a>
      </section>
    </main>
  );
}
