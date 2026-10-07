import { AuthPage } from '../../components/auth-page';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return <AuthPage mode="sign-in" />;
}
