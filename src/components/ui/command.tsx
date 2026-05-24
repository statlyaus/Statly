'use client';

import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import clsx from 'clsx';

export function Command({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className
      )}
      {...props}
    />
  );
}

export function CommandInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  );
}

export function CommandList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('max-h-80 overflow-auto', className)} {...props} />;
}

export function CommandEmpty({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('px-3 py-4 text-sm text-muted-foreground', className)}>{children}</div>
  );
}

export function CommandGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('p-1', className)}>{children}</div>;
}

export function CommandItem({ className, children, ...props }: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx(
        'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
