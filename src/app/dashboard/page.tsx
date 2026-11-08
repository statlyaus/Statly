import { redirect } from 'next/navigation';

import { AuthProvider } from '@/AuthContext';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { canUseBasketball } from '@/server/basketball/basketballAccess';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) {
    redirect('/login');
  }

  return (
    <AuthProvider>
      <DashboardClient showBasketball={canUseBasketball(userId)} />
    </AuthProvider>
  );
}
