'use client';

import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type UILabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function UILabel({ className, ...props }: UILabelProps) {
  return (
    <label
      className={cn(
        'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  );
}
