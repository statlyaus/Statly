import Link from 'next/link';

import { buttonStyles } from '@/components/ui/controlStyles';
/** Shown on every public trade page while no owner-approved trade data is being served. */
export function TradesUnavailable() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold text-foreground">AFL trades</h1>
      <p className="mt-3 max-w-[60ch] text-muted-foreground">
        Trade records are unavailable. This page cannot load until they are back.
      </p>
      <p className="mt-6">
        <Link href="/afl" className={buttonStyles()}>
          Back to AFL
        </Link>
      </p>
    </div>
  );
}
