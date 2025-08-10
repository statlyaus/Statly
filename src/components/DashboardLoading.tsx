import LoadingSpinner from './LoadingSpinner';

export default function DashboardLoading() {
  return (
    <main
      className="container mx-auto p-4 sm:p-6 lg:p-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div role="status" className="flex flex-col items-center">
        <LoadingSpinner />
        <span className="sr-only">Loading dashboard...</span>
      </div>
      <h1 className="text-2xl font-bold">Loading your dashboard…</h1>
    </main>
  );
}
