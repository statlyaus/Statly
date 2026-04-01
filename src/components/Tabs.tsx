'use client';

import { UITabs } from '@/components/ui';

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
  return <UITabs tabs={tabs} active={active} onChange={onChange} />;
}
