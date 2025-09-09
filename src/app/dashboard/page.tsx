import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ClientShell from './ClientShell';
import {
  DashboardSettings,
  defaultDashboardSettings,
  dashboardSettingsSchema,
} from '@/hooks/useDashboardSettings';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export default async function Page() {
  const session = cookies().get('statly_session')?.value;
  if (!session) redirect('/login');

  let uid: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    uid = decoded.uid;
  } catch (error) {
    console.error('Session verification failed:', error);
    redirect('/login');
  }

  // Load dashboard settings with validation and error handling
  let settings: DashboardSettings;
  try {
    const ref = adminDb
      .collection('users')
      .doc(uid)
      .collection('dashboardSettings')
      .doc('default');
    const snap = await ref.get();
    if (snap.exists) {
      const parsed = dashboardSettingsSchema.safeParse(snap.data());
      settings = parsed.success ? parsed.data : defaultDashboardSettings;
    } else {
      settings = defaultDashboardSettings;
    }
  } catch (error) {
    console.error('Failed to load dashboard settings:', error);
    settings = defaultDashboardSettings;
  }

  return <ClientShell uid={uid} initialSettings={settings} />;
}