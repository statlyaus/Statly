'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';

import { sendBasketballCommand } from '../analysis/basketballApi';

/**
 * Records a free agent as rostered by a team the user has not entered, so he leaves the list. The
 * row only goes once the server confirms and the page re-renders.
 */
export function MarkTakenButton({
  leagueId,
  userId,
  playerId,
  playerName,
}: {
  leagueId: string;
  userId: string;
  playerId: string;
  playerName: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markTaken = async () => {
    setSaving(true);
    setError(null);
    const result = await sendBasketballCommand(
      `/api/basketball/leagues/${encodeURIComponent(leagueId)}/roster`,
      'POST',
      { entries: [{ playerId, teamId: null }] },
      userId
    );
    if (!result.ok) {
      setSaving(false);
      setError(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={markTaken}
        disabled={saving}
        aria-label={`Mark as taken: ${playerName} is rostered elsewhere`}
        className={buttonStyles({ variant: 'outline', size: 'xs' })}
      >
        {saving ? 'Saving…' : 'Mark as taken'}
      </button>
      {error ? (
        <span role="alert" className="text-right text-xs text-result-loss">
          Not saved. {error}
        </span>
      ) : null}
    </span>
  );
}
