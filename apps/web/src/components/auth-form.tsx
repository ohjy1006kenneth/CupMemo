'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '../auth/client';

type AuthFormProps = { mode: 'sign-in' | 'sign-up' };

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const signingUp = mode === 'sign-up';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const result = signingUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(
          result.error.status >= 500 || result.error.status === 0
            ? signingUp
              ? 'We couldn’t create your account right now. Please try again.'
              : 'We couldn’t sign you in right now. Please try again.'
            : signingUp
              ? 'We couldn’t create your account. Check your details and try again.'
              : 'Email or password is incorrect. Try again.',
        );
        return;
      }
      setPassword('');
      router.replace('/app');
      router.refresh();
    } catch {
      setError(
        signingUp
          ? 'We couldn’t create your account right now. Please try again.'
          : 'We couldn’t sign you in right now. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={submit}
      aria-busy={pending}
      onInvalid={(event) => {
        event.preventDefault();
        const input = event.target as HTMLInputElement;
        const firstInvalid = Array.from(input.form?.elements ?? []).find(
          (element) => element instanceof HTMLInputElement && !element.validity.valid,
        ) as HTMLInputElement | undefined;
        firstInvalid?.focus();
        const message =
          input.name === 'email'
            ? 'Enter a valid email address.'
            : input.name === 'name'
              ? 'Enter your name.'
              : 'Enter a password between 8 and 128 characters.';
        setFieldErrors((errors) => ({ ...errors, [input.name]: message }));
      }}
    >
      {signingUp && (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            pattern={'.*\\S.*'}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors((errors) => ({ ...errors, name: '' }));
            }}
          />
          {fieldErrors.name && (
            <p id="name-error" className="form-error" aria-live="polite">
              {fieldErrors.name}
            </p>
          )}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors((errors) => ({ ...errors, email: '' }));
          }}
        />
        {fieldErrors.email && (
          <p id="email-error" className="form-error" aria-live="polite">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          required
          minLength={8}
          maxLength={128}
          aria-invalid={!!fieldErrors.password}
          aria-describedby={
            [signingUp ? 'password-hint' : '', fieldErrors.password ? 'password-error' : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((errors) => ({ ...errors, password: '' }));
          }}
        />
        {fieldErrors.password && (
          <p id="password-error" className="form-error" aria-live="polite">
            {fieldErrors.password}
          </p>
        )}
        {signingUp && (
          <p className="field-hint" id="password-hint">
            Use at least 8 characters.
          </p>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}
      </button>
      <p className="form-switch">
        {signingUp ? 'Already have an account?' : 'New to CupMemo?'}{' '}
        <Link href={signingUp ? '/sign-in' : '/sign-up'}>
          {signingUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
      {pending && (
        <span className="visually-hidden" role="status">
          {signingUp ? 'Creating your account' : 'Signing you in'}
        </span>
      )}
    </form>
  );
}
