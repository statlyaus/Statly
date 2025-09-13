import type { HTMLAttributes, JSX as ReactJSX } from 'react';

import clsx from 'clsx';

export default function Table({
  className,
  role: _role,
  ...rest
}: HTMLAttributes<HTMLTableElement>): ReactJSX.Element {
  // Use native table semantics so it is discoverable via getByRole('table')
  if (process.env.NODE_ENV !== 'production' && _role != null) {
    // Warn in development when consumers try to override native semantics
    console.warn('Table: ignoring provided `role` prop to preserve native <table> semantics.');
  }
  return <table className={clsx('min-w-full divide-y divide-neutral-200', className)} {...rest} />;
}
export type TableClassKey =
  | 'container'
  | 'thead'
  | 'th'
  | 'tbody'
  | 'trZebra'
  | 'td'
  | 'tdNumeric';

export const tableClasses = {
  container: 'overflow-x-auto',
  thead: 'bg-neutral-50 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider',
  th: 'px-3 py-2 sticky top-0 bg-neutral-50 z-10',
  tbody: 'bg-white divide-y divide-neutral-200',
  trZebra: 'odd:bg-white even:bg-neutral-50',
  td: 'px-3 py-2 align-middle text-sm text-neutral-800',
  tdNumeric: 'px-3 py-2 align-middle text-sm text-neutral-800 text-right tabular-nums',
} as const satisfies Record<TableClassKey, string>;

export type TableClasses = typeof tableClasses;
