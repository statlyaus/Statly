import clsx from 'clsx';
import type { FormHTMLAttributes } from 'react';

export default function Form({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form className={clsx('space-y-4', className)} {...props} />;
}
