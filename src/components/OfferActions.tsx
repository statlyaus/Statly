// src/components/OfferActions.tsx
'use client';
import { useState } from 'react';
import { useTradeStore } from '@/state/tradeStore';

type OfferStatus = 'sent' | 'counter' | 'accepted' | 'declined' | 'failed';

export default function OfferActions() {
  const { incoming, outgoing, clearAll } = useTradeStore();
  const [history, setHistory] = useState<Array<{ id: string; when: string; incoming: number; outgoing: number; status: OfferStatus }>>([]);

  const send = async () => {
    const id = crypto.randomUUID();
    const when = new Date().toLocaleString();

    try {
      const res = await fetch('/api/trade-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incoming, outgoing }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const status = (data.status as OfferStatus) ?? 'sent';

        setHistory([{ id, when, incoming: incoming.length, outgoing: outgoing.length, status }, ...history]);
      } else {
        setHistory([{ id, when, incoming: incoming.length, outgoing: outgoing.length, status: 'declined' }, ...history]);
      }
    } catch (error) {
      console.error('Failed to submit offer:', error);
      setHistory([{ id, when, incoming: incoming.length, outgoing: outgoing.length, status: 'failed' }, ...history]);
    } finally {
      clearAll();
    }
  };

  return (
    <div className="rounded-xl bg-gray-800 p-4 ring-1 ring-black/10">
      <button
        className="w-full rounded-md bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        onClick={send}
        disabled={incoming.length + outgoing.length === 0}
      >
        Submit Trade Offer
      </button>

      <h4 className="mt-4 text-gray-300 font-medium">History</h4>
      {history.length === 0 ? (
        <p className="text-xs text-gray-500">No offers yet.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {history.map(h => (
            <li key={h.id} className="rounded bg-gray-900 border border-gray-700 p-2">
              <div className="flex justify-between">
                <span>{h.when}</span>
                <span className="text-gray-400">{h.status}</span>
              </div>
              <div className="text-xs text-gray-400">{h.outgoing} out • {h.incoming} in</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}