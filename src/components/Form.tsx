import type { FormHTMLAttributes } from 'react';

import clsx from 'clsx';

export default function Form({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form className={clsx('space-y-4', className)} {...props} />;
}
