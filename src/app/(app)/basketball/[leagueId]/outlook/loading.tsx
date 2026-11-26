import { Spinner } from '@/components/ui/Spinner';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner label="Loading the outlook" />
    </div>
  );
}
