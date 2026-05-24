import { AuthProvider } from '@/AuthContext';
import DashboardClient from './DashboardClient';

export default function DashboardPage() {
  return (
    <AuthProvider>
      <DashboardClient />
    </AuthProvider>
  );
}
