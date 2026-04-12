'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { motion } from 'framer-motion';

import { fetchApi } from '@/lib/api';
import { computeSnakeState } from '@/lib/snakeDraft';

import type { User } from 'firebase/auth';

interface LiveDraftModuleProps {
  refreshTrigger: number;
  user: User;
}

interface DraftMeta {
  id: string;
  status: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  timePerPick: number;
  participants: Array<{
    slot: number;
    member: { userId: string; displayName: string };
  }>;
}

export default function LiveDraftModule({ refreshTrigger, user }: LiveDraftModuleProps) {
  const [draft, setDraft] = useState<DraftMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const listRes = await fetchApi('drafts/list', { signal: controller.signal });
        const drafts = listRes.data?.drafts ?? [];
        const activeDraft = (drafts as Array<Pick<DraftMeta, 'id' | 'status'>>).find(
          (d) => d.status === 'LIVE'
        );
        if (!activeDraft) {
          if (active) setDraft(null);
          return;
        }

        const detailRes = await fetchApi(`drafts/${activeDraft.id}`, { signal: controller.signal });
        const d = detailRes.data;
        const meta: DraftMeta = {
          id: d.id,
          status: d.status,
          currentPick: d.currentPick,
          totalPicks: d.totalPicks,
          round: d.round,
          direction: d.direction,
          timePerPick: d.timePerPick,
          participants: d.participants,
        };
        if (active) setDraft(meta);
      } catch (e) {
        if (active && (e as any)?.name !== 'AbortError')
          setError(e instanceof Error ? e.message : 'Failed to load draft');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshTrigger, user?.uid]);

  const isParticipant = !!draft?.participants.find((p) => p.member.userId === user.uid);

  // Determine turn information
  const teamCount = draft?.participants.length ?? 0;
  let isYourTurn = false;
  let picksUntilYourTurn = 0;

  if (draft && teamCount > 0) {
    if (isParticipant) {
      const { slot: currentSlot } = computeSnakeState(draft.currentPick, teamCount);
      const mySlot = draft.participants.find((p) => p.member.userId === user.uid)?.slot;
      isYourTurn = mySlot === currentSlot;

      if (!isYourTurn && mySlot) {
        let nextPickNumber = draft.currentPick + 1;
        let tempPicksUntilYourTurn = 0;
        while (nextPickNumber <= draft.totalPicks) {
          const { slot: nextSlot } = computeSnakeState(nextPickNumber, teamCount);
          if (nextSlot === mySlot) {
            picksUntilYourTurn = tempPicksUntilYourTurn;
            break;
          }
          tempPicksUntilYourTurn++;
          nextPickNumber++;
        }
      }
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
        Loading draft state…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!draft || draft.status === 'COMPLETED') {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white">
          <svg
            className="h-6 w-6 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <h4 className="text-sm font-semibold text-slate-900">No active draft</h4>
        <p className="mt-1 text-sm text-slate-600">
          Create or join a draft when you want draft state to appear here.
        </p>
        <Link
          href="/drafts/create"
          className="mt-4 inline-flex items-center rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Create Draft
        </Link>
      </div>
    );
  }

  const joinHref = `/drafts/${draft.id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse"></div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
          Draft live
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Pick Progress</span>
          <span className="font-medium">
            {draft.currentPick}/{draft.totalPicks}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200">
          <motion.div
            className="h-2 rounded-full bg-slate-950"
            initial={{ width: 0 }}
            animate={{ width: `${(draft.currentPick / draft.totalPicks) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {isParticipant ? (
        isYourTurn ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2">
              <svg
                className="h-5 w-5 text-emerald-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="font-medium text-emerald-900">Your turn</span>
            </div>
            <p className="mt-1 text-sm text-emerald-700">Time per pick: {draft.timePerPick}s</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-800">
              <span className="font-medium">{picksUntilYourTurn} picks</span> until your turn
            </p>
          </div>
        )
      ) : (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-slate-800">You’re not in this draft. You can watch or join.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={joinHref}
          className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Join Draft
        </Link>
        <button className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white">
          Watch Only
        </button>
      </div>
    </div>
  );
}
