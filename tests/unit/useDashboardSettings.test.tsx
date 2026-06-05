import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import { getDoc } from 'firebase/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  useDashboardSettings,
  defaultDashboardSettings,
} from '../../src/hooks/useDashboardSettings';

const { setDoc } = vi.hoisted(() => ({
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => defaultDashboardSettings,
  }),
  setDoc,
  onSnapshot: vi.fn(() => () => {}),
}));

vi.mock('@/lib/firebaseClient', () => ({ db: {} }));

describe('useDashboardSettings', () => {
  it('optimistically updates settings', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDashboardSettings('u1', defaultDashboardSettings), {
      wrapper,
    });
    await act(async () => {
      await expect(result.current.updateSettings({ theme: 'dark' })).resolves.toBeDefined();
    });
  });

  it('falls back to default when Firestore data missing', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce(dashboardSettingsSnapshot(undefined, false));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDashboardSettings('u1'), { wrapper });
    await waitFor(() => {
      expect(result.current.settings).toEqual(defaultDashboardSettings);
    });
  });

  it('falls back to default when Firestore data invalid', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce(dashboardSettingsSnapshot(null, true));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {children}
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDashboardSettings('u1'), { wrapper });
    await waitFor(() => {
      expect(result.current.settings).toEqual(defaultDashboardSettings);
    });
  });
});

function dashboardSettingsSnapshot(
  data: unknown,
  exists: boolean
): Awaited<ReturnType<typeof getDoc>> {
  return {
    exists(): this is QueryDocumentSnapshot<unknown, DocumentData> {
      return exists;
    },
    data: () => data,
  } as Awaited<ReturnType<typeof getDoc>>;
}
