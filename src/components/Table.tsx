import clsx from 'clsx';
import type { HTMLAttributes, JSX as ReactJSX } from 'react';

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
