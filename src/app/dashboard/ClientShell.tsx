'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { QueryProvider } from '@/providers/QueryProvider';
import { SocketProvider } from '@/providers/SocketProvider';
import { useDashboardSettings, DashboardSettings } from '@/hooks/useDashboardSettings';
import AppLayout from '@/components/navigation/AppLayout';

const TopPicksModule = dynamic(
  () => import('@/components/modules/TopPicksModule'),
  {
    loading: () => (
      <div className="h-[300px]" aria-busy="true" aria-label="Loading Top Picks…" />
    ),
  }
);

interface Props {
  uid: string;
  initialSettings: DashboardSettings;
}

const moduleMap: Record<string, React.ComponentType> = {
  topPicks: TopPicksModule,
};

export default function ClientShell({ uid, initialSettings }: Props) {
  return (
    <QueryProvider>
      <SocketProvider uid={uid}>
        <Inner uid={uid} initialSettings={initialSettings} />
      </SocketProvider>
    </QueryProvider>
  );
}

function Inner({ uid, initialSettings }: Props) {
  const { settings } = useDashboardSettings(uid, initialSettings);
  const modules = useMemo(
    () => settings.layout.filter((m) => m.enabled).sort((a, b) => a.order - b.order),
    [settings.layout]
  );

  return (
    <AppLayout>
      <div
        role="region"
        aria-label="Dashboard modules"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {modules.map((m) => {
          const Comp = moduleMap[m.id];
          if (!Comp) {
            console.warn(`Unknown module ID encountered in dashboard layout: ${m.id}`);
            return (
              <div
                key={m.id}
                className="border border-red-500 bg-red-50 text-red-700 p-2 rounded"
                data-unknown-module
              >
                Unknown module: <strong>{m.id}</strong>
              </div>
            );
          }
          return <Comp key={m.id} />;
        })}
      </div>
    </AppLayout>
  );
}
