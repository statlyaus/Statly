import 'server-only';
import AdminWorkersClient from './AdminWorkersClient';

function isAdminWorkerUiEnabled() {
  return (
    process.env.STATLY_RUNTIME_ENV === 'local' &&
    process.env.STATLY_ENABLE_ADMIN_WORKER_UI === 'true'
  );
}

export default async function AdminWorkersPage() {
  if (!isAdminWorkerUiEnabled()) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 p-6" aria-label="Admin Workers unavailable">
        <p className="text-sm font-medium text-muted-foreground">Admin Workers</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Worker controls are not available from this browser session.
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This operational page is disabled unless the local operator UI is explicitly enabled.
          Worker pool API access remains protected by the configured admin token policy.
        </p>
      </main>
    );
  }

  return <AdminWorkersClient />;
}
