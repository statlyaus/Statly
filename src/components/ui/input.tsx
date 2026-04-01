'use client';

import type { InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type UIInputProps = InputHTMLAttributes<HTMLInputElement>;

export function UIInput({ className, type = 'text', ...props }: UIInputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
