// src/components/OfferActions.tsx
'use client';
import { useState } from 'react';

import { fetchApi } from '@/lib/api';
import { useTradeStore } from '@/state/tradeStore';

export default function OfferActions() {
  const { incoming, outgoing, clearAll } = useTradeStore();
  const [history, setHistory] = useState<
    Array<{
      id: string;
      when: string;
      incoming: number;
      outgoing: number;
      status: 'sent' | 'counter' | 'accepted' | 'declined';
    }>
  >([]);

  const send = async () => {
    const id = Math.random().toString(36).slice(2);
    setHistory([
      {
        id,
        when: new Date().toLocaleString(),
        incoming: incoming.length,
        outgoing: outgoing.length,
        status: 'sent',
      },
      ...history,
    ]);
    try {
      const data = await fetchApi('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incoming, outgoing }),
      });
      setHistory((h) =>
        h.map((item) =>
          item.id === id ? { ...item, status: data.success ? 'accepted' : 'declined' } : item
        )
      );
    } catch (_err) {
      setHistory((h) => h.map((item) => (item.id === id ? { ...item, status: 'declined' } : item)));
    } finally {
      clearAll();
    }
  };

  return (
    <div className="rounded-xl bg-muted p-4 ring-1 ring-black/10">
      <button
        className="w-full rounded-md bg-info py-2 text-white hover:bg-info disabled:opacity-50"
        onClick={send}
        disabled={incoming.length + outgoing.length === 0}
      >
        Submit Trade Offer
      </button>

      <h4 className="mt-4 text-muted-foreground font-medium">History</h4>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">No offers yet.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="rounded bg-foreground border border-border p-2">
              <div className="flex justify-between">
                <span>{h.when}</span>
                <span className="text-muted-foreground">{h.status}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {h.outgoing} out • {h.incoming} in
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
