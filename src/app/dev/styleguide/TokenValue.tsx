'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/** A token's value as the browser resolved it on `:root`, so the page shows `src/index.css` as it is. */
export function TokenValue({ name }: { name: string }) {
  const value = useSyncExternalStore(
    noSubscription,
    () => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    () => ''
  );
  return <code className="font-sans text-xs text-muted-foreground">{value || '…'}</code>;
}
