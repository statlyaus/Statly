'use client';

import React, {
  type ButtonHTMLAttributes,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import clsx from 'clsx';

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

type PopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function Popover({ open, onOpenChange, children }: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      onOpenChange(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onOpenChange, open]);

  const contextValue = useMemo<PopoverContextValue>(
    () => ({
      open,
      setOpen: onOpenChange,
      triggerRef,
      contentRef,
    }),
    [onOpenChange, open]
  );

  return <PopoverContext.Provider value={contextValue}>{children}</PopoverContext.Provider>;
}

type PopoverTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  children: ReactNode;
};

export function PopoverTrigger({ className, children, onClick, ...props }: PopoverTriggerProps) {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error('PopoverTrigger must be used within Popover');
  }

  return (
    <button
      ref={context.triggerRef}
      type="button"
      {...props}
      aria-haspopup="dialog"
      aria-expanded={context.open}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context.setOpen(!context.open);
        }
      }}
      className={className}
    >
      {children}
    </button>
  );
}

type PopoverContentProps = HTMLAttributes<HTMLDivElement> & {
  className?: string;
  align?: 'start' | 'end';
  children: ReactNode;
};

export function PopoverContent({
  className,
  align = 'start',
  children,
  ...props
}: PopoverContentProps) {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error('PopoverContent must be used within Popover');
  }

  if (!context.open) {
    return null;
  }

  return (
    <div
      ref={context.contentRef}
      role="dialog"
      {...props}
      className={clsx(
        'absolute top-full z-50 mt-2 min-w-[18rem] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
    >
      {children}
    </div>
  );
}
