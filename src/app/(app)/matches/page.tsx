'use client';

import { RealTimeMatchCenter } from '@/components/advanced';
import { useRouter } from 'next/navigation';

export default function MatchesPage() {
  const router = useRouter();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Match Centre</h1>
      </div>

      <RealTimeMatchCenter
        onPlayerSelect={(player) => {
          router.push(`/players/${player.id}`);
        }}
      />
    </div>
  );
}
