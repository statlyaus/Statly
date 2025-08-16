// src/state/tradeReviewStore.ts

import { create } from 'zustand';
import {
  acceptTrade,
  archiveTrade,
  createTrade,
  deleteTrade,
  fetchTradeDetails,
  fetchTrades,
  overrideTradeStatus,
  processTrade,
  vetoTrade,
} from '@/lib/api'; // Corrected import path

// Types for the store
export type TradeStatus = 'offered' | 'accepted' | 'underReview' | 'processed' | 'vetoed' | 'archived';

export interface TradeSummary {
  tradeId: string;
  summary: {
    tradeName?: string;
    status: TradeStatus;
    teamCount: number;
    playerNames: string[];
    lastUpdated: number;
    archived?: boolean;
  };
}

export interface TradeState {
  status: TradeStatus;
  vetoCount?: number;
  reviewWindowExpiresAt?: number;
  invalidRoster?: boolean;
}

interface ReviewState {
  trades: TradeSummary[];
  activeTradeId: string | null;
  activeTrade: {
    state: TradeState | null;
    auditLog: Array<{ timestamp: number; action: string; details?: unknown }>; // More specific type
    notifications: string[];
  } | null;
  loading: boolean;
  error: string | null;
}

interface ReviewActions {
  fetchTrades: () => Promise<void>;
  fetchTradeDetails: (tradeId: string) => Promise<void>;
  setActiveTradeId: (tradeId: string | null) => void;
  createTrade: (tradeName: string) => Promise<void>;
  acceptTrade: () => Promise<void>;
  vetoTrade: () => Promise<void>;
  processTrade: () => Promise<void>;
  deleteTrade: (tradeId: string) => Promise<void>;
  archiveTrade: (tradeId: string) => Promise<void>;
  adminOverride: (status: TradeStatus) => Promise<void>;
}

// Create the Zustand store
export const useTradeReviewStore = create<ReviewState & ReviewActions>((set, get) => ({
  trades: [],
  activeTradeId: null,
  activeTrade: null,
  loading: false,
  error: null,

  setActiveTradeId: (tradeId) => {
    set({ activeTradeId: tradeId });
    if (tradeId) {
      get().fetchTradeDetails(tradeId);
    } else {
      set({ activeTrade: null });
    }
  },

  fetchTrades: async () => {
    set({ loading: true, error: null });
    try {
      const trades = await fetchTrades();
      set({ trades, loading: false });
    } catch (error: unknown) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchTradeDetails: async (tradeId) => {
    set({ loading: true, error: null });
    try {
      const details = await fetchTradeDetails(tradeId);
      set({ activeTrade: details, loading: false });
    } catch (error: unknown) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createTrade: async (tradeName) => {
    set({ loading: true, error: null });
    try {
      const newTrade = await createTrade(tradeName);
      set((state) => ({
        trades: [...state.trades, newTrade],
        activeTradeId: newTrade.tradeId,
        loading: false,
      }));
      await get().fetchTradeDetails(newTrade.tradeId);
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },

  acceptTrade: async () => {
    const { activeTradeId } = get();
    if (!activeTradeId) return;
    set({ loading: true, error: null });
    try {
      const updatedTrade = await acceptTrade(activeTradeId);
      set({ activeTrade: updatedTrade, loading: false });
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },

  vetoTrade: async () => {
    const { activeTradeId } = get();
    if (!activeTradeId) return;
    set({ loading: true, error: null });
    try {
      const updatedTrade = await vetoTrade(activeTradeId);
      set({ activeTrade: updatedTrade, loading: false });
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },

  processTrade: async () => {
    const { activeTradeId } = get();
    if (!activeTradeId) return;
    set({ loading: true, error: null });
    try {
      const updatedTrade = await processTrade(activeTradeId);
      set({ activeTrade: updatedTrade, loading: false });
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },

  deleteTrade: async (tradeId) => {
    set({ loading: true, error: null });
    try {
      await deleteTrade(tradeId);
      set((state) => ({
        trades: state.trades.filter((t) => t.tradeId !== tradeId),
        loading: false,
      }));
      if (get().activeTradeId === tradeId) {
        set({ activeTradeId: null, activeTrade: null });
      }
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },

    archiveTrade: async (tradeId) => {
        set({ loading: true, error: null });
        try {
            await archiveTrade(tradeId);
            set((state) => ({
                trades: state.trades.map((t) =>
                    t.tradeId === tradeId ? { ...t, summary: { ...t.summary, archived: true } } : t
                ),
                loading: false,
            }));
        } catch (error: unknown) {
            set({ error: (error as Error).message, loading: false });
        }
    },


  adminOverride: async (status) => {
    const { activeTradeId } = get();
    if (!activeTradeId) return;
    set({ loading: true, error: null });
    try {
      const updatedTrade = await overrideTradeStatus(activeTradeId, status);
      set({ activeTrade: updatedTrade, loading: false });
    } catch (error: unknown) {
        set({ error: (error as Error).message, loading: false });
    }
  },
}));