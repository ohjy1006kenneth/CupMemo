'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '../auth/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError('We couldn’t sign you out. Please try again.');
        return;
      }
      router.replace('/sign-in');
      router.refresh();
    } catch {
      setError('We couldn’t sign you out. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="signout-area">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="secondary-button" type="button" onClick={signOut} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {pending && (
        <span className="visually-hidden" role="status">
          Signing you out
        </span>
      )}
    </div>
  );
}
