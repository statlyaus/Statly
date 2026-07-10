'use client';

import { useAuth } from '@/AuthContext';
import DashboardLoading from '@/components/DashboardLoading';
import UserDashboard from '@/components/UserDashboard';
import { AppLayout } from '@/components/navigation';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardClient() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=%2Fdashboard');
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return <DashboardLoading />;
  }

  return (
    <AppLayout>
      <UserDashboard user={user} />
    </AppLayout>
  );
}
