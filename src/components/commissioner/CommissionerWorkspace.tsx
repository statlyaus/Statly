'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fetchApi } from '@/lib/api';
import type {
  CommissionerLeague,
  CommissionerLeagueMember,
} from '@/server/leagues/commissionerReadModel';

interface CommissionerWorkspaceProps {
  leagues: CommissionerLeague[];
  selectedLeagueId: string;
}

type Feedback = { kind: 'status' | 'alert'; message: string } | null;

const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

export default function CommissionerWorkspace({
  leagues,
  selectedLeagueId,
}: CommissionerWorkspaceProps) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const league = leagues.find((candidate) => candidate.id === selectedLeagueId) ?? leagues[0];

  const runMemberAction = async (
    member: CommissionerLeagueMember,
    action: 'removeMember' | 'transferOwnership',
    successMessage: string
  ) => {
    setFeedback(null);
    setPendingUserId(member.userId);
    try {
      await fetchApi(`leagues/${league.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ action, targetUserId: member.userId }),
      });
      setFeedback({ kind: 'status', message: successMessage });
      router.refresh();
    } catch (error) {
      setFeedback({
        kind: 'alert',
        message: error instanceof Error ? error.message : 'That change could not be saved.',
      });
    } finally {
      setPendingUserId(null);
    }
  };

  const removeMember = async (member: CommissionerLeagueMember) => {
    const confirmed = await confirm({
      title: `Remove ${member.teamName}?`,
      description: 'Their team leaves the league and its draft slot is given to the next team.',
      confirmLabel: 'Remove manager',
      tone: 'danger',
    });
    if (confirmed) await runMemberAction(member, 'removeMember', `${member.teamName} was removed.`);
  };

  const transferOwnership = async (member: CommissionerLeagueMember) => {
    const confirmed = await confirm({
      title: `Make ${member.teamName} the owner?`,
      description: 'You stay in the league as a manager and lose commissioner tools.',
      confirmLabel: 'Transfer ownership',
    });
    if (confirmed) {
      await runMemberAction(
        member,
        'transferOwnership',
        `${member.teamName} now owns ${league.name}.`
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Commissioner</p>
          <h1 className="text-2xl font-semibold text-foreground">{league.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {league.members.length} of {league.maxTeams} teams · Invite code{' '}
            <span className="font-mono font-semibold text-foreground">{league.inviteCode}</span>
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {leagues.length > 1 ? (
            <label className="block text-sm font-semibold text-foreground">
              League
              <select
                value={league.id}
                onChange={(event) => router.push(`/commissioner?league=${event.target.value}`)}
                className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
              >
                {leagues.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Link
            href={`/leagues/${league.id}?tab=league-settings`}
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            League settings
          </Link>
        </div>
      </header>

      {feedback ? (
        <p
          role={feedback.kind}
          className={`rounded-md border p-3 text-sm font-medium ${
            feedback.kind === 'alert'
              ? 'border-result-loss/30 bg-result-loss/5 text-result-loss'
              : 'border-result-win/30 bg-result-win/5 text-result-win'
          }`}
        >
          {feedback.message}
        </p>
      ) : null}

      <section
        aria-labelledby="commissioner-members-heading"
        className="rounded-lg border border-border bg-background"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="commissioner-members-heading" className="text-base font-semibold text-foreground">
            Managers
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {league.memberRemovalOpen
              ? 'You can remove managers until the draft starts.'
              : 'The draft has started, so managers can no longer be removed.'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Team
                </th>
                <th scope="col" className="hidden px-4 py-2 sm:table-cell">
                  Joined
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {league.members.map((member) => (
                <tr key={member.userId} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="block font-semibold text-foreground">{member.teamName}</span>
                    <span className="block text-muted-foreground">
                      {member.managerName ?? 'Manager'}
                      {member.isOwner ? ' · Owner' : null}
                    </span>
                  </th>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {dateFormatter.format(new Date(member.joinedAt))}
                  </td>
                  <td className="px-4 py-3">
                    {member.isOwner ? null : (
                      <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          disabled={pendingUserId !== null}
                          onClick={() => void transferOwnership(member)}
                          aria-label={`Make ${member.teamName} owner`}
                          className="inline-flex h-11 items-center rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          Make owner
                        </button>
                        {league.memberRemovalOpen ? (
                          <button
                            type="button"
                            disabled={pendingUserId !== null}
                            onClick={() => void removeMember(member)}
                            aria-label={`Remove ${member.teamName}`}
                            className="inline-flex h-11 items-center rounded-md border border-result-loss/40 px-3 text-sm font-semibold text-result-loss hover:bg-result-loss/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dialog}
    </div>
  );
}
