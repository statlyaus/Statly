import clsx from 'clsx';
import type { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export default function FormField({ label, children, className }: FormFieldProps) {
  return (
    <div className={clsx('space-y-1', className)}>
      <label className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
