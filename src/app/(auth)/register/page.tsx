import Link from 'next/link';
import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <AuthForm initialMode="signup" />
        <div className="text-center">
          <Link href="/login">
            <Button type="button" variant="secondary">
              Have an account? Log in
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
