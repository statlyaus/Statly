'use client';

import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

type AccordionType = 'single' | 'multiple';

type AccordionContextValue = {
  type: AccordionType;
  value: string | string[] | undefined;
  setValue: (itemValue: string) => void;
};

type AccordionItemContextValue = {
  value: string;
  open: boolean;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);
const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

type AccordionProps = {
  type?: AccordionType;
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  className?: string;
  children: ReactNode;
};

export function Accordion({
  type = 'single',
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: AccordionProps) {
  const [internalValue, setInternalValue] = useState<string | string[] | undefined>(defaultValue);
  const resolvedValue = value ?? internalValue;

  const contextValue = useMemo<AccordionContextValue>(
    () => ({
      type,
      value: resolvedValue,
      setValue: (itemValue) => {
        if (type === 'single') {
          const nextValue = resolvedValue === itemValue ? '' : itemValue;
          setInternalValue(nextValue);
          onValueChange?.(nextValue);
          return;
        }

        const currentValues = Array.isArray(resolvedValue) ? resolvedValue : [];
        const nextValues = currentValues.includes(itemValue)
          ? currentValues.filter((value) => value !== itemValue)
          : [...currentValues, itemValue];
        setInternalValue(nextValues);
        onValueChange?.(nextValues);
      },
    }),
    [onValueChange, resolvedValue, type]
  );

  return (
    <AccordionContext.Provider value={contextValue}>
      <div className={cn('w-full', className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

type AccordionItemProps = {
  value: string;
  className?: string;
  children: ReactNode;
};

export function AccordionItem({ value, className, children }: AccordionItemProps) {
  const accordion = useContext(AccordionContext);
  if (!accordion) {
    throw new Error('AccordionItem must be used within an Accordion');
  }

  const open =
    accordion.type === 'single'
      ? accordion.value === value
      : Array.isArray(accordion.value) && accordion.value.includes(value);

  return (
    <AccordionItemContext.Provider value={{ value, open }}>
      <div
        className={cn('border-b border-border', className)}
        data-state={open ? 'open' : 'closed'}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

type AccordionTriggerProps = {
  className?: string;
  children: ReactNode;
};

export function AccordionTrigger({ className, children }: AccordionTriggerProps) {
  const accordion = useContext(AccordionContext);
  const item = useContext(AccordionItemContext);

  if (!accordion || !item) {
    throw new Error('AccordionTrigger must be used within an AccordionItem');
  }

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium transition hover:text-foreground/80',
        className
      )}
      onClick={() => accordion.setValue(item.value)}
      aria-expanded={item.open}
      data-state={item.open ? 'open' : 'closed'}
    >
      <span>{children}</span>
      <ChevronDown
        className={cn(
          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
          item.open && 'rotate-180'
        )}
      />
    </button>
  );
}

type AccordionContentProps = {
  className?: string;
  children: ReactNode;
};

export function AccordionContent({ className, children }: AccordionContentProps) {
  const item = useContext(AccordionItemContext);

  if (!item) {
    throw new Error('AccordionContent must be used within an AccordionItem');
  }

  if (!item.open) {
    return null;
  }

  return (
    <div className={cn('pb-4 pt-0', className)} data-state="open">
      {children}
    </div>
  );
}
