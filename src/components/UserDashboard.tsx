import type { AuthUser } from '@/AuthContext';
import ModularDashboard from './ModularDashboard';

interface UserDashboardProps {
  user: AuthUser;
}

export default function UserDashboard({ user }: UserDashboardProps) {
  return <ModularDashboard user={user} />;
}
