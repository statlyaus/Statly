'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // If the user is already logged in, redirect them to the dashboard.
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  // Don't render the form if the user is