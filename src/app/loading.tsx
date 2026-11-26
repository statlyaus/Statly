import { Spinner } from '@/components/ui/Spinner';

export default function Loading() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner label="Loading the page" />
    </div>
  );
}
