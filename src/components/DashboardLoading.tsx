import LoadingSpinner from './LoadingSpinner';

export default function DashboardLoading() {
  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div role="status" className="flex flex-col items-center">
        <LoadingSpinner />
        <h1 className="mt-2 text-2xl font-bold">Loading your dashboard…</h1>
      </div>
    </main>
  );
}
