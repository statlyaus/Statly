import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import {
  useDashboardSettings,
  defaultDashboardSettings,
} from '../../src/hooks/useDashboardSettings';

const { setDoc } = vi.hoisted(() => ({ setDoc: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => true, data: () => defaultDashboardSettings() }),
  setDoc,
  onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('@/lib/firebaseClient', () => ({ db: {} }));

describe('useDashboardSettings', () => {
  it('optimistically updates settings', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useDashboardSettings('u1', defaultDashboardSettings()),
      { wrapper }
    );
    await act(async () => {
      await expect(result.current.updateSettings({ theme: 'dark' })).resolves.toBeDefined();
    });
  });
});
