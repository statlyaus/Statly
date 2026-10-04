'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';

/**
 * The CSS reduced-motion rule in index.css cannot reach animations framer-motion drives from
 * JavaScript, so honour the operating system setting here for every motion component.
 */
export default function MotionPreferenceProvider({ children }: { readonly children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
