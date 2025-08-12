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
  return (
    <div className="flex space-x-2 border-b border-neutral-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={clsx(
            'px-3 py-2 text-sm',
            active === t.value
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-neutral-600 hover:text-neutral-900',
          )}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
