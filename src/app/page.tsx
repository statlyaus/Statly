'use client';

import AuthForm from '@/components/AuthForm';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-4 sm:p-24">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">Welcome to Statly</h1>
        <AuthForm />
      </div>
    </main>
  );
}