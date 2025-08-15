import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export default function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const base =
    'px-4 py-2 rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2';
  const styles =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
      : 'bg-neutral-200 text-neutral-900 hover:bg-neutral-300 focus:ring-neutral-400';

  return <button className={clsx(base, styles, className)} {...props} />;
}
