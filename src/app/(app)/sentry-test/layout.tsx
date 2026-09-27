import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { isDevelopmentToolsEnabled } from '@/server/developmentTools';

export default function SentryTestLayout({ children }: { children: ReactNode }) {
  if (!isDevelopmentToolsEnabled()) {
    notFound();
  }

  return children;
}
