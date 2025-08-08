'use client';

import { useAuth } from '@/AuthContext';
import AuthCTA from '@/components/AuthCTA';
import DashboardLoading from '@/components/DashboardLoading';
import UserDashboard from '@/components/UserDashboard';

export default function DashboardPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <DashboardLoading />;
  }

  if (!user) {
    return <AuthCTA />;
  }

  return <UserDashboard user={user} />;
}
