import type { Metadata } from 'next';
import ForgotPasswordForm from './ForgotPasswordForm';
import Button from '@/components/Button';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Forgot password | Statly',
  description: 'Reset your Statly account password',
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Reset password</h1>
        <ForgotPasswordForm />
        <div className="text-center">
          <Button href="/login" variant="secondary">
            Back to sign in
          </Button>
        </div>
      </div>
    </main>
  );
}
