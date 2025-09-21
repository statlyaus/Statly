'use client';

import clsx from 'clsx';

export interface TabItem {
  value: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (value: string) => void;
}

export default function Tabs({ tabs, active, onChange }: TabsProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.value === active);
    if (idx < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      onChange(next.value);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      onChange(prev.value);
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex space-x-2 border-b border-neutral-200"
    >
      {tabs.map((t) => {
        const tabId = `tab-${t.value}`;
        const panelId = `tabpanel-${t.value}`;
        return (
          <button
            key={t.value}
            id={tabId}
            role="tab"
            aria-selected={active === t.value}
            aria-controls={panelId}
            tabIndex={active === t.value ? 0 : -1}
            className={clsx(
              'px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t',
              active === t.value
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-neutral-600 hover:text-neutral-900'
            )}
            onClick={() => onChange(t.value)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
