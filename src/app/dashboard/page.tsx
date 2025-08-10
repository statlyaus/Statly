"use client";

import { useAuth } from "@/AuthContext";
import DashboardLoading from "@/components/DashboardLoading";
import AuthCTA from "@/components/AuthCTA";
import UserDashboard from "@/components/UserDashboard";

export default function Page() {
  const { user, loading } = useAuth();

  if (loading) {
    return <DashboardLoading />;
  }

  if (!user) {
    return <AuthCTA />;
  }

  return <UserDashboard user={user} />;
}
