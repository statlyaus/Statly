'use client';

import { useAuth } from '@/AuthContext';
import DashboardLoading from '@/components/DashboardLoading';
import UserDashboard from '@/components/UserDashboard';
import { AppLayout } from '@/components/navigation';

export default function DashboardClient() {
  const { user, loading } = useAuth();

  if (loading || !user) {
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
