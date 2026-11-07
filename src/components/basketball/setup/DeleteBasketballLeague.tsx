'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buttonStyles } from '@/components/ui/controlStyles';

import { callBasketballApi } from '../shell/basketballApi';

/** Deletes the profile after a confirmation; the real league on Yahoo or ESPN is untouched. */
export function DeleteBasketballLeague({ leagueId, name }: { leagueId: string; name: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const confirmed = await confirm({
      title: `Delete ${name}?`,
      description:
        'This removes the league and its teams, rosters and matchups from Statly. It cannot be undone. Your real league is not affected.',
      confirmLabel: 'Delete league',
      tone: 'danger',
    });
    if (!confirmed) return;
    setPending(true);
    setError(null);
    const result = await callBasketballApi<{ id: string }>(
      `/api/basketball/leagues/${encodeURIComponent(leagueId)}`,
      'DELETE'
    );
    if (!result.ok) {
      setPending(false);
      setError(result.message);
      return;
    }
    router.push('/basketball');
    router.refresh();
  }

  return (
    <section
      aria-labelledby="bb-delete-title"
      className="grid gap-4 border-t border-border py-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
    >
      <h2 id="bb-delete-title" className="font-display text-lg font-bold text-foreground">
        Delete league
      </h2>
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Removes this league profile and everything entered for it from Statly.
        </p>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={buttonStyles({ variant: 'danger' })}
        >
          {pending ? 'Deleting…' : 'Delete league'}
        </button>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {dialog}
    </section>
  );
}
