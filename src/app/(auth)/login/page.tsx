import Link from 'next/link';
import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <AuthForm initialMode="login" />
        <div className="text-center">
          <Link href="/register">
            <Button type="button" variant="secondary">
              Create account
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
