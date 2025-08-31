'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebaseClient';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

interface PreDraftChecklistProps {
  draftId: string;
  memberId: string;
  watchlistCount: number;
  queueCount: number;
}

const defaultItems: ChecklistItem[] = [
  { id: 'rankings', label: 'Rankings set', completed: false },
  { id: 'watchlist', label: 'Watchlist updated', completed: false },
];

export default function PreDraftChecklist({
  draftId,
  memberId,
  watchlistCount,
  queueCount,
}: PreDraftChecklistProps) {
  const [items, setItems] = useState<ChecklistItem[]>(defaultItems);

  // Subscribe to stored checklist
  useEffect(() => {
    if (!db || !draftId || !memberId) return;
    const ref = doc(db, 'drafts', draftId, 'checklists', memberId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as Record<string, boolean> | undefined;
        setItems(
          defaultItems.map((item) => ({
            ...item,
            completed: data ? Boolean(data[item.id]) : false,
          }))
        );
      },
      (error) => {
        console.error('Checklist snapshot error', error);
      }
    );
    return () => unsubscribe();
  }, [draftId, memberId]);

  // Update checklist based on local state
  useEffect(() => {
    if (!db || !draftId || !memberId) return;
    const ref = doc(db, 'drafts', draftId, 'checklists', memberId);
    const desired = {
      rankings: queueCount > 0,
      watchlist: watchlistCount > 0,
    };
    const current = items.reduce((acc, i) => {
      if (i.id === 'rankings' || i.id === 'watchlist') acc[i.id] = i.completed;
      return acc;
    }, {} as Record<'rankings' | 'watchlist', boolean>);
    if (current.rankings === desired.rankings && current.watchlist === desired.watchlist) return;
    (async () => {
      try {
        await setDoc(ref, desired, { merge: true });
      } catch (err) {
        console.error('Failed to update checklist', err);
      }
    })();
  }, [draftId, memberId, queueCount, watchlistCount, items]);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-gray-900 mb-2">Your Checklist</h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center text-sm text-gray-700">
            <span className="mr-2">
              {item.completed ? '✅' : '⬜'}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

