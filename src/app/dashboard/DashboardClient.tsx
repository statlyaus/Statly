'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/AuthContext';
import DashboardLoading from '@/components/DashboardLoading';
import { AppLayout } from '@/components/navigation';
import UserDashboard from '@/components/UserDashboard';

export default function DashboardClient() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/fantasy');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <AppLayout>
        <DashboardLoading />
      </AppLayout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <AppLayout>
      <UserDashboard user={user} />
    </AppLayout>
  );
}
