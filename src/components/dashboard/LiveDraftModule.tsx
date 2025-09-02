"use client";

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { fetchApi } from '@/lib/api';

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
        const activeDraft = drafts.find((d: { id: string; status: string }) => d.status !== 'COMPLETED');
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
        if (active && (e as any)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load draft');
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
    const round = Math.ceil(draft.currentPick / teamCount);
    const directionForward = round % 2 === 1;
    const currentSlot = directionForward
      ? ((draft.currentPick - 1) % teamCount) + 1
      : teamCount - ((draft.currentPick - 1) % teamCount);
    const mySlot = draft.participants.find((p) => p.member.userId === user.uid)?.slot;
    isYourTurn = mySlot === currentSlot;

    if (!isYourTurn && mySlot) {
      let nextPickNumber = draft.currentPick + 1;
      let tempPicksUntilYourTurn = 0;
      while (nextPickNumber <= draft.totalPicks) {
        const nextRound = Math.ceil(nextPickNumber / teamCount);
        const nextDirectionForward = nextRound % 2 === 1;
        const nextSlot = nextDirectionForward
          ? ((nextPickNumber - 1) % teamCount) + 1
          : teamCount - ((nextPickNumber - 1) % teamCount);

        if (nextSlot === mySlot) {
            picksUntilYourTurn = tempPicksUntilYourTurn;
            break;
        }
        tempPicksUntilYourTurn++;
        nextPickNumber++;
      }
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Loading draft...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!draft || draft.status === 'COMPLETED') {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg
            className="w-8 h-8 text-slate-400"
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
        <h4 className="font-medium text-slate-900 mb-1">No Active Draft</h4>
        <p className="text-sm text-slate-600 mb-3">Create or join a draft to get started</p>
        <Link
          href="/drafts/create"
          className="inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Draft
        </Link>
      </div>
    );
  }

  const joinHref = `/drafts/${draft.id}`;

  return (
    <div className="space-y-4">
      {/* Live Indicator */}
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
        <span className="text-sm font-medium text-red-600">DRAFT LIVE</span>
      </div>

      {/* Draft Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Pick Progress</span>
          <span className="font-medium">
            {draft.currentPick}/{draft.totalPicks}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <motion.div
            className="bg-blue-600 h-2 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(draft.currentPick / draft.totalPicks) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Turn Status */}
      {isParticipant ? (
        isYourTurn ? (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <svg
                className="w-5 h-5 text-green-600"
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
              <span className="font-medium text-green-800">Your Turn!</span>
            </div>
            <p className="text-sm text-green-700 mt-1">Time per pick: {draft.timePerPick}s</p>
          </div>
        ) : (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <span className="font-medium">{picksUntilYourTurn} picks</span> until your turn
            </p>
          </div>
        )
      ) : (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-sm text-slate-800">You’re not in this draft. You can watch or join.</p>
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={joinHref}
          className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors text-center"
        >
          Join Draft
        </Link>
        <button className="px-3 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors">
          Watch Only
        </button>
      </div>
    </div>
  );
}

