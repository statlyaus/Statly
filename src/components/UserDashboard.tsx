import ModularDashboard from './ModularDashboard';

import type { User } from 'firebase/auth';

interface UserDashboardProps {
  user: User;
}

export default function UserDashboard({ user }: UserDashboardProps) {
  return <ModularDashboard user={user} />;
}
