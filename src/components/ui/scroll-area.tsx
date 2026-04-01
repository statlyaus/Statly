import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ScrollAreaProps = {
  className?: string;
  viewportClassName?: string;
  children: ReactNode;
};

export function ScrollArea({ className, viewportClassName, children }: ScrollAreaProps) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div className={cn('h-full w-full overflow-auto', viewportClassName)}>{children}</div>
    </div>
  );
}
