'use client';

import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import { fieldStyles, menuItemStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';

export function Command({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden', className)} {...props} />
  );
}

export function CommandInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldStyles({ size: 'sm' }), className)} {...props} />;
}

export function CommandList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('max-h-80 overflow-auto', className)} {...props} />;
}

export function CommandEmpty({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-3 py-4 text-sm text-muted-foreground', className)}>{children}</div>;
}

export function CommandGroup({ className, children }: { className?: string; children: ReactNode }) {
  // p-2 keeps a row's focus outline (7px out) inside the scrolling list.
  return <div className={cn('p-2', className)}>{children}</div>;
}

export function CommandItem({ className, children, ...props }: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn(menuItemStyles(), className)} {...props}>
      {children}
    </button>
  );
}
