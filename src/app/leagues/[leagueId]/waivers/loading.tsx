import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoadingSpinner size="md" color="gray">
        <span className="sr-only">Loading waivers…</span>
      </LoadingSpinner>
    </div>
  );
}
