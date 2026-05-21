'use client';

import { useAuth } from '@/AuthContext';
import DashboardLoading from '@/components/DashboardLoading';
import { AppLayout } from '@/components/navigation';
import UserDashboard from '@/components/UserDashboard';

export default function DashboardClient() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <AppLayout>
        <DashboardLoading />
      </AppLayout>
    );
  }

  if (!user) {
    return (
      <AppLayout>
        <DashboardLoading />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <UserDashboard user={user} />
    </AppLayout>
  );
}
