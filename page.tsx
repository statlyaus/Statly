'use client';

import React from 'react';
import { useAuth } from '@/AuthContext';
import { useRouter } from 'next/navigation';

const DashboardPage: React.FC = () => {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    // If loading is finished and there's no user, redirect to the login page.
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // Show a loading state while auth status is being determined.
  if (loading || !user) {
    return <div className="p-4 text-center">Loading...</div>;
  }

  // Render the dashboard for the logged-in user.
  return (
    <div className="p-4 md:p-8">
      <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
      <p className="text-lg">Welcome back, <span className="font-semibold">{user.email}</span>!</p>
    </div>
  );
};

export default DashboardPage;