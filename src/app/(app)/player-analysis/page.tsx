'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function PlayerAnalysisPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the new players page
    router.replace('/players');
  }, [router]);

  return <LoadingSpinner />;
}
