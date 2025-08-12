import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

export default function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={clsx('min-w-full divide-y divide-neutral-200', className)} {...props} />;
}
