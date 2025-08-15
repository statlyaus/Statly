import type { User } from 'firebase/auth';
import ModularDashboard from './ModularDashboard';

interface UserDashboardProps {
  user: User;
}

export default function UserDashboard({ user }: UserDashboardProps) {
  return <ModularDashboard user={user} />;
}
