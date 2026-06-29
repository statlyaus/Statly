'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/AuthContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueMemberOption {
  id: string;
  userId: string;
  teamName: string;
}

interface LeagueTradeProposalFormProps {
  leagueId: string;
  requestedPlayerId?: string | null;
  ownerMemberId?: string | null;
}

interface LeagueDetailResponse {
  success: true;
  data: {
    members: LeagueMemberOption[];
  };
}

function isLeagueDetailResponse(value: unknown): value is LeagueDetailResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === 'object' &&
    Array.isArray((value as { data: { members?: unknown } }).data.members)
  );
}

function parsePlayerIds(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function LeagueTradeProposalForm({
  leagueId,
  requestedPlayerId,
  ownerMemberId,
}: LeagueTradeProposalFormProps): React.JSX.Element | null {
  const { user, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<LeagueMemberOption[]>([]);
  const [selectedOwnerMemberId, setSelectedOwnerMemberId] = useState(ownerMemberId ?? '');
  const [playersOffered, setPlayersOffered] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(Boolean(requestedPlayerId));
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedPlayerId || authLoading || !user?.uid) return;
    let mounted = true;

    async function loadLeague() {
      try {
        setLoading(true);
        const response = await authenticatedFetch(`/api/leagues/${encodeURIComponent(leagueId)}`, {}, user?.uid);
        const body = (await response.json()) as unknown;
        if (!response.ok || !isLeagueDetailResponse(body)) {
          throw new Error('Failed to load league members.');
        }
        if (!mounted) return;
        setMembers(body.data.members);
        if (ownerMemberId) setSelectedOwnerMemberId(ownerMemberId);
      } catch (error) {
        if (mounted) {
          setStatusMessage(error instanceof Error ? error.message : 'Failed to load trade form.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadLeague();
    return () => {
      mounted = false;
    };
  }, [authLoading, leagueId, ownerMemberId, requestedPlayerId, user?.uid]);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === user?.uid) ?? null,
    [members, user?.uid]
  );
  const recipientMember = useMemo(
    () => members.find((member) => member.id === selectedOwnerMemberId) ?? null,
    [members, selectedOwnerMemberId]
  );

  if (!requestedPlayerId) return null;

  const canSubmit = Boolean(
    currentMember && recipientMember && playersOffered.trim().length > 0 && requestedPlayerId
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.uid || !currentMember || !recipientMember || !requestedPlayerId) return;

    try {
      setSubmitting(true);
      setStatusMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/trades`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromTeamId: currentMember.id,
            toTeamId: recipientMember.id,
            fromUserId: user.uid,
            toUserId: recipientMember.userId,
            playersOffered: parsePlayerIds(playersOffered),
            playersRequested: [requestedPlayerId],
            message: message.trim() || `Trade proposal for ${requestedPlayerId}`,
          }),
        },
        user.uid
      );
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.error || 'Failed to propose trade.');
      }
      setPlayersOffered('');
      setMessage('');
      setStatusMessage(`Trade proposal created${body.id ? `: ${body.id}` : ''}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to propose trade.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Propose Trade</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Request player <span className="font-semibold text-foreground">{requestedPlayerId}</span>{' '}
            from the selected owner.
          </p>
        </div>
        {loading && <span className="text-sm text-muted-foreground">Loading members...</span>}
      </div>

      <form className="mt-4 grid grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)_120px] gap-3" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="trade-owner" className="text-xs font-medium text-muted-foreground">
            Owner
          </label>
          <select
            id="trade-owner"
            value={selectedOwnerMemberId}
            onChange={(event) => setSelectedOwnerMemberId(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">Select owner</option>
            {members
              .filter((member) => member.userId !== user?.uid)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.teamName}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="trade-offer" className="text-xs font-medium text-muted-foreground">
            Players you offer
          </label>
          <input
            id="trade-offer"
            value={playersOffered}
            onChange={(event) => setPlayersOffered(event.target.value)}
            placeholder="Player IDs, comma separated"
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </div>

        <div>
          <label htmlFor="trade-message" className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <input
            id="trade-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Optional note"
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Sending...' : 'Send'}
        </button>
      </form>

      {statusMessage && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {statusMessage}
        </div>
      )}
    </section>
  );
}
