import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ClientShell from './ClientShell';
import {
  DashboardSettings,
  defaultDashboardSettings,
} from '@/hooks/useDashboardSettings';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export default async function Page() {
  const session = cookies().get('statly_session')?.value;
  if (!session) redirect('/login');

  let uid: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    uid = decoded.uid as string;
  } catch {
    redirect('/login');
  }

  const ref = adminDb
    .collection('users')
    .doc(uid)
    .collection('dashboardSettings')
    .doc('default');
  const snap = await ref.get();
  const settings = snap.exists
    ? (snap.data() as DashboardSettings)
    : defaultDashboardSettings;

  return <ClientShell uid={uid} initialSettings={settings} />;
}
