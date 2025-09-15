'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui';

export default function PlayerAnalysisClient() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/players');
  }, [router]);
  return <LoadingSpinner />;
}

