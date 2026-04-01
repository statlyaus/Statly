'use client';

import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export interface UITabItem {
  value: string;
  label: string;
}

interface UITabsProps {
  tabs: UITabItem[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

export function UITabs({ tabs, active, onChange, className }: UITabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.value === active);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(tabs[(currentIndex + 1) % tabs.length].value);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(tabs[(currentIndex - 1 + tabs.length) % tabs.length].value);
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
    >
      {tabs.map((tab) => {
        const tabId = `tab-${tab.value}`;
        const panelId = `tabpanel-${tab.value}`;
        const isActive = tab.value === active;

        return (
          <button
            key={tab.value}
            id={tabId}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            className={cn(
              'inline-flex min-w-24 items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
