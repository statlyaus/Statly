import { redirect } from 'next/navigation';

import { AuthProvider } from '@/AuthContext';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) {
    redirect('/login');
  }

  return (
    <AuthProvider>
      <DashboardClient />
    </AuthProvider>
  );
}
