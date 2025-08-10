import LoadingSpinner from "./LoadingSpinner";

export default function DashboardLoading() {
  return (
    <main
      className="flex flex-col items-center p-6 space-y-6"
      role="main"
      aria-busy="true"
    >
      <LoadingSpinner />
      <div className="w-full max-w-md space-y-4 animate-pulse">
        <div className="h-6 w-3/4 mx-auto rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </main>
  );
}