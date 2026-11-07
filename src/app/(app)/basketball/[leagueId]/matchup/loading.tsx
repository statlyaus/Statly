import LoadingSpinner from '@/components/LoadingSpinner';

export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoadingSpinner />
    </div>
  );
}
