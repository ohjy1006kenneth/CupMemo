// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from '../apps/web/src/components/auth-form';
import { SignOutButton } from '../apps/web/src/components/sign-out-button';

const { replace, refresh, signIn, signUp, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('../apps/web/src/auth/client', () => ({
  authClient: {
    signIn: { email: signIn },
    signUp: { email: signUp },
    signOut,
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('authentication form interactions', () => {
  it('associates inline invalid-input errors and suppresses duplicate pending submits', async () => {
    let resolve!: (value: { error: null }) => void;
    signIn.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<AuthForm mode="sign-in" />);
    const email = screen.getByLabelText('Email');
    fireEvent.invalid(email);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', expect.stringContaining('email-error'));
    fireEvent.change(email, { target: { value: 'jamie@example.test' } });
    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'coffee-secret-8' } });
    fireEvent.submit(password.closest('form')!);
    fireEvent.submit(password.closest('form')!);
    expect(signIn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
    resolve({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
  });

  it('does not mislabel a server outage as invalid credentials', async () => {
    signIn.mockResolvedValue({ error: { status: 503, message: 'unsafe upstream detail' } });
    render(<AuthForm mode="sign-in" />);
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t sign you in right now.',
    );
  });
  it('submits sign-in credentials once, clears the password, and navigates only on success', async () => {
    signIn.mockResolvedValue({ data: { token: 'not-rendered' }, error: null });
    render(<AuthForm mode="sign-in" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jamie@example.test' } });
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'coffee-secret-8' } });
    fireEvent.submit(password.closest('form')!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app'));
    expect(signIn).toHaveBeenCalledWith({
      email: 'jamie@example.test',
      password: 'coffee-secret-8',
    });
    expect(password.value).toBe('');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows a generic signup failure without navigating or exposing backend text', async () => {
    signUp.mockResolvedValue({ error: { message: 'duplicate account secret details' } });
    render(<AuthForm mode="sign-up" />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jamie' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jamie@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'coffee-secret-8' } });
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t create your account.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('duplicate account');
    expect(replace).not.toHaveBeenCalled();
  });

  it('waits for successful server sign-out and leaves the user in place on failure', async () => {
    signOut
      .mockResolvedValueOnce({ error: { message: 'unsafe raw detail' } })
      .mockResolvedValueOnce({ error: null });
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t sign you out.');
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
