import type { HTMLAttributes, JSX as ReactJSX } from 'react';

import { cn } from '@/lib/utils';

export function UITable({
  className,
  role: _role,
  ...rest
}: HTMLAttributes<HTMLTableElement>): ReactJSX.Element {
  if (process.env.NODE_ENV !== 'production' && _role != null) {
    console.warn('Table: ignoring provided `role` prop to preserve native <table> semantics.');
  }

  return <table className={cn('w-full caption-bottom text-sm', className)} {...rest} />;
}

export type TableClassKey = 'container' | 'thead' | 'th' | 'tbody' | 'trZebra' | 'td' | 'tdNumeric';

export const tableClasses = {
  container: 'overflow-x-auto rounded-md border border-border bg-card shadow-sm',
  thead:
    'border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground',
  th: 'px-3 py-2.5 align-middle font-medium whitespace-nowrap',
  tbody: 'divide-y divide-border bg-background',
  trZebra: 'odd:bg-background even:bg-muted/20',
  td: 'px-3 py-2.5 align-middle text-sm text-foreground',
  tdNumeric: 'px-3 py-2.5 align-middle text-right text-sm tabular-nums text-foreground',
} as const satisfies Record<TableClassKey, string>;

export type TableStateClassKey = 'empty' | 'loading' | 'error';

export const tableStateClasses = {
  empty: 'px-3 py-8 text-center text-sm text-muted-foreground',
  loading: 'px-3 py-8 text-center text-sm text-muted-foreground',
  error: 'px-3 py-8 text-center text-sm text-destructive',
} as const satisfies Record<TableStateClassKey, string>;
