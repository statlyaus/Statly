'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import { z } from 'zod';
import * as Sentry from '@sentry/react';

export const dashboardSettingsSchema = z.object({
  layout: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      order: z.number(),
      size: z.enum(['sm', 'md', 'lg']),
    })
  ),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  updatedAt: z.number(),
  version: z.literal(1),
});

export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;

export const defaultDashboardSettings: DashboardSettings = {
  layout: [],
  theme: 'system',
  updatedAt: Date.now(),
  version: 1,
};

export function useDashboardSettings(uid: string, initial?: DashboardSettings) {
  const queryClient = useQueryClient();
  const key = ['dashboard-settings', uid];

  const fetchSettings = async (): Promise<DashboardSettings> => {
    if (!db) return defaultDashboardSettings;
    const ref = doc(db, 'users', uid, 'dashboardSettings', 'default');
    const snap = await getDoc(ref);
    if (!snap.exists()) return defaultDashboardSettings;
    return dashboardSettingsSchema.parse(snap.data());
  };

  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchSettings,
    initialData: initial,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!db) return;
    const ref = doc(db, 'users', uid, 'dashboardSettings', 'default');
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const parsed = dashboardSettingsSchema.safeParse(snap.data());
        if (parsed.success) {
          queryClient.setQueryData(key, parsed.data);
        } else {
          Sentry.captureMessage('Invalid dashboardSettings snapshot', {
            extra: { issues: parsed.error.issues },
          });
        }
      },
      (err) => {
        Sentry.captureException(err);
      }
    );
  }, [uid, queryClient]);

  const mutation = useMutation({
    mutationFn: async (partial: Partial<DashboardSettings>) => {
      if (!db) return defaultDashboardSettings;
      const ref = doc(db, 'users', uid, 'dashboardSettings', 'default');
      const updated = {
        ...(data ?? defaultDashboardSettings),
        ...partial,
        updatedAt: Date.now(),
      } as DashboardSettings;
      await setDoc(ref, updated, { merge: true });
      return updated;
    },
    onMutate: async (partial) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<DashboardSettings>(key);
      const optimistic = {
        ...(prev ?? defaultDashboardSettings),
        ...partial,
        updatedAt: Date.now(),
      } as DashboardSettings;
      queryClient.setQueryData(key, optimistic);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return { settings: data || defaultDashboardSettings, updateSettings: mutation.mutateAsync };
}