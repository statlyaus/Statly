'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type {
  TradeDetails,
  TradeReviewAction,
  TradeStatus,
  TradeSummary,
} from '@/components/trades/tradeApi';
import { actOnTrade } from '@/components/trades/tradeApi';
import {
  createRequestId,
  fetchLeagueMembers,
  fetchLeagueRoster,
  fetchLeagueTrades,
  fetchTradeDetails,
  isHttp404Error,
  type LeagueMember,
  submitTradeReviewAction,
  submitTradeRequest,
} from '@/components/trades/tradeDataService';
import { formatPlayerDisplay, resolvePlayerMeta } from '@/components/trades/tradePlayerUtils';
import {
  formatNetImpact,
  isTradeActive,
  isTradeAwaitingManagerAction,
  mapTradeUiError,
} from '@/components/trades/tradeUiUtils';
import type { RosterPlayer } from '@/components/trades/tradeUiTypes';
import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

type UseLeagueTradesParams = {
  leagueId: string;
  currentUserId: string | null;
  preselectedIncomingPlayerId?: string;
  preselectedRecipientUserId?: string;
};

type StatsContainer = {
  stats?: Record<string, unknown>;
};

type ReviewActionLoading = TradeReviewAction | null;

function canManageReviewForRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? '').toUpperCase();
  return normalized === 'OWNER' || normalized === 'COMMISSIONER';
}

function hasReviewWindowClosed(reviewWindowEndsAt: string | undefined): boolean {
  if (!reviewWindowEndsAt) return false;
  const timestamp = new Date(reviewWindowEndsAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function sumByKeys(
  players: StatsContainer[],
  keys: CanonicalStatKey[]
): Record<CanonicalStatKey, number> {
  const totals = keys.reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {} as Record<CanonicalStatKey, number>
  );
  players.forEach((player) => {
    const stats = player.stats ?? {};
    keys.forEach((key) => {
      const value = stats[key];
      const asNumber = Number(value ?? 0);
      totals[key] += Number.isFinite(asNumber) ? asNumber : 0;
    });
  });
  return totals;
}

function computeImpact(
  outPlayers: StatsContainer[],
  inPlayers: StatsContainer[],
  keys: CanonicalStatKey[]
) {
  const outTotals = sumByKeys(outPlayers, keys);
  const inTotals = sumByKeys(inPlayers, keys);
  const deltaTotals = keys.reduce(
    (acc, key) => {
      acc[key] = (inTotals[key] ?? 0) - (outTotals[key] ?? 0);
      return acc;
    },
    {} as Record<CanonicalStatKey, number>
  );
  return { outTotals, inTotals, deltaTotals };
}

export function useLeagueTrades({
  leagueId,
  currentUserId,
  preselectedIncomingPlayerId,
  preselectedRecipientUserId,
}: UseLeagueTradesParams) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedTradeId, setSelectedTradeId] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [details, setDetails] = useState<Record<string, TradeDetails>>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOptionsLoading, setCreateOptionsLoading] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionType, setActionType] = useState<'accept' | 'decline' | 'cancel' | null>(null);
  const [actionTradeId, setActionTradeId] = useState<string | null>(null);
  const [reviewActionLoading, setReviewActionLoading] = useState<ReviewActionLoading>(null);
  const [inboxStatusFilter, setInboxStatusFilter] = useState<'ALL' | 'PROPOSED' | 'COMPLETED'>(
    'ALL'
  );
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const createRequestRef = useRef(0);

  const [recipients, setRecipients] = useState<LeagueMember[]>([]);
  const [leagueMembers, setLeagueMembers] = useState<LeagueMember[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([]);
  const [recipientRosterPlayers, setRecipientRosterPlayers] = useState<RosterPlayer[]>([]);
  const [recipientUserId, setRecipientUserId] = useState('');
  const [outgoingIds, setOutgoingIds] = useState<string[]>([]);
  const [incomingIds, setIncomingIds] = useState<string[]>([]);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [counterParentTradeId, setCounterParentTradeId] = useState<string | null>(null);
  const [recipientRosterLoading, setRecipientRosterLoading] = useState(false);
  const [recipientRosterError, setRecipientRosterError] = useState<string | null>(null);
  const [rosterCache, setRosterCache] = useState<Record<string, RosterPlayer[]>>({});
  const [impactLoadingUsers, setImpactLoadingUsers] = useState<Record<string, boolean>>({});
  const [confirmCreate, setConfirmCreate] = useState(false);
  const recipientRosterRequestRef = useRef(0);
  const prefillSignatureRef = useRef('');
  const { visibleKeys, allKeys, toggleKey, defaultKeys, labels } = useLeagueStatColumns(leagueId);

  const incomingTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.recipientUserId === currentUserId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [trades, currentUserId]
  );

  const outgoingTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.proposerUserId === currentUserId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [trades, currentUserId]
  );

  const filteredIncomingTrades = useMemo(() => {
    if (inboxStatusFilter === 'ALL') return incomingTrades;
    if (inboxStatusFilter === 'PROPOSED') {
      return incomingTrades.filter((trade) => isTradeActive(trade));
    }
    return incomingTrades.filter((trade) => !isTradeActive(trade));
  }, [incomingTrades, inboxStatusFilter]);

  const filteredOutgoingTrades = useMemo(() => {
    if (inboxStatusFilter === 'ALL') return outgoingTrades;
    if (inboxStatusFilter === 'PROPOSED') {
      return outgoingTrades.filter((trade) => isTradeActive(trade));
    }
    return outgoingTrades.filter((trade) => !isTradeActive(trade));
  }, [outgoingTrades, inboxStatusFilter]);

  const selectedTrade =
    trades.find((trade) => trade.tradeId === selectedTradeId) ??
    incomingTrades[0] ??
    outgoingTrades[0] ??
    null;
  const selectedDetails = selectedTrade ? details[selectedTrade.tradeId] : null;
  const pendingIncomingCount = incomingTrades.filter((trade) => isTradeActive(trade)).length;
  const pendingOutgoingCount = outgoingTrades.filter((trade) => isTradeActive(trade)).length;
  const closedTradeCount = trades.filter((trade) => !isTradeActive(trade)).length;

  const teamNameByUserId = useMemo(() => {
    const byId = new Map<string, string>();
    leagueMembers.forEach((member) => {
      byId.set(member.userId, member.teamName);
    });
    return byId;
  }, [leagueMembers]);

  const gives = selectedDetails
    ? selectedDetails.items.filter((item) => item.fromUserId === currentUserId)
    : [];
  const receives = selectedDetails
    ? selectedDetails.items.filter((item) => item.toUserId === currentUserId)
    : [];

  const isProposer = selectedTrade?.proposerUserId === currentUserId;
  const isRecipient = selectedTrade?.recipientUserId === currentUserId;
  const isPending = selectedTrade ? isTradeAwaitingManagerAction(selectedTrade) : false;
  const isReviewPending = selectedTrade?.status === 'REVIEW_PENDING';
  const currentLeagueMember = leagueMembers.find((member) => member.userId === currentUserId);
  const canManageSelectedReview = canManageReviewForRole(currentLeagueMember?.role);
  const hasCurrentUserVetoed = Boolean(
    currentUserId &&
      selectedDetails?.reviewVotes?.some(
        (vote) => vote.voterUserId === currentUserId && vote.voteType === 'VETO'
      )
  );

  const acceptEnabled = Boolean(isRecipient && isPending);
  const declineEnabled = Boolean(isRecipient && isPending);
  const cancelEnabled = Boolean(isProposer && (isPending || isReviewPending));
  const counterEnabled = Boolean(isRecipient && isPending);
  const approveReviewEnabled = Boolean(
    selectedTrade?.status === 'REVIEW_PENDING' &&
      selectedTrade.reviewMode === 'ADMIN' &&
      canManageSelectedReview
  );
  const rejectReviewEnabled = approveReviewEnabled;
  const finalizeReviewEnabled = Boolean(
    selectedTrade?.status === 'REVIEW_PENDING' &&
      selectedTrade.reviewMode === 'VETO' &&
      canManageSelectedReview &&
      hasReviewWindowClosed(selectedTrade.reviewWindowEndsAt)
  );
  const vetoReviewEnabled = Boolean(
    selectedTrade?.status === 'REVIEW_PENDING' &&
      selectedTrade.reviewMode === 'VETO' &&
      currentLeagueMember &&
      !isProposer &&
      !isRecipient &&
      !hasCurrentUserVetoed
  );

  const outgoingPlayers = rosterPlayers.filter((player) => outgoingIds.includes(player.id));
  const incomingPlayers = recipientRosterPlayers.filter((player) =>
    incomingIds.includes(player.id)
  );
  const createImpact = computeImpact(outgoingPlayers, incomingPlayers, visibleKeys);
  const createNetImpact = formatNetImpact(createImpact.deltaTotals, visibleKeys);
  const createSummary =
    outgoingPlayers.length || incomingPlayers.length
      ? `You're trading ${outgoingPlayers.map(formatPlayerDisplay).join(', ') || 'no one'} for ${
          incomingPlayers.map(formatPlayerDisplay).join(', ') || 'no one'
        }.`
      : null;

  const selectedRecipientName =
    recipients.find((member) => member.userId === recipientUserId)?.teamName ??
    leagueMembers.find((member) => member.userId === recipientUserId)?.teamName ??
    null;

  const missingRecipient = !recipientUserId;
  const missingOutgoing = outgoingIds.length === 0;
  const missingIncoming = incomingIds.length === 0;
  const createStep = missingRecipient ? 1 : missingOutgoing ? 2 : missingIncoming ? 3 : 4;
  const submitDisabled =
    !currentUserId ||
    missingRecipient ||
    missingOutgoing ||
    missingIncoming ||
    createOptionsLoading ||
    createSubmitting ||
    detailLoading;

  const reviewRosterForProposer = selectedTrade?.proposerUserId
    ? rosterCache[selectedTrade.proposerUserId]
    : undefined;
  const reviewRosterForRecipient = selectedTrade?.recipientUserId
    ? rosterCache[selectedTrade.recipientUserId]
    : undefined;

  const proposerRosterReady = Boolean(
    selectedTrade?.proposerUserId && Array.isArray(rosterCache[selectedTrade.proposerUserId])
  );
  const recipientRosterReady = Boolean(
    selectedTrade?.recipientUserId && Array.isArray(rosterCache[selectedTrade.recipientUserId])
  );

  const reviewOutPlayers = gives
    .map((item) => resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache))
    .filter((player): player is RosterPlayer => Boolean(player));
  const reviewInPlayers = receives
    .map((item) => resolvePlayerMeta(item.playerId, item.fromUserId, rosterCache))
    .filter((player): player is RosterPlayer => Boolean(player));

  const reviewImpact = computeImpact(reviewOutPlayers, reviewInPlayers, visibleKeys);
  const reviewImpactLoading = Boolean(
    selectedTrade &&
    (!proposerRosterReady || !recipientRosterReady) &&
    (impactLoadingUsers[selectedTrade.proposerUserId] ||
      impactLoadingUsers[selectedTrade.recipientUserId] ||
      !proposerRosterReady ||
      !recipientRosterReady)
  );

  const reviewNetImpact = formatNetImpact(reviewImpact.deltaTotals, visibleKeys);

  const reviewTopGains = useMemo(
    () =>
      visibleKeys
        .map((key) => ({ key, delta: reviewImpact.deltaTotals[key] ?? 0 }))
        .filter((row) => row.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3),
    [reviewImpact.deltaTotals, visibleKeys]
  );

  const reviewTopRisks = useMemo(
    () =>
      visibleKeys
        .map((key) => ({ key, delta: reviewImpact.deltaTotals[key] ?? 0 }))
        .filter((row) => row.delta < 0)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 3),
    [reviewImpact.deltaTotals, visibleKeys]
  );

  const createTopGains = useMemo(
    () =>
      visibleKeys
        .map((key) => ({ key, delta: createImpact.deltaTotals[key] ?? 0 }))
        .filter((row) => row.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3),
    [createImpact.deltaTotals, visibleKeys]
  );

  const createTopRisks = useMemo(
    () =>
      visibleKeys
        .map((key) => ({ key, delta: createImpact.deltaTotals[key] ?? 0 }))
        .filter((row) => row.delta < 0)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 3),
    [createImpact.deltaTotals, visibleKeys]
  );

  useEffect(() => {
    let mounted = true;
    const fetchMembers = async () => {
      if (!currentUserId) return;
      try {
        const members = await fetchLeagueMembers(leagueId);
        if (!mounted) return;
        setLeagueMembers(members);
      } catch (err) {
        if (!mounted) return;
        if (isHttp404Error(err)) return;
      }
    };

    void fetchMembers();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  useEffect(() => {
    let mounted = true;
    const fetchTrades = async () => {
      if (!currentUserId) {
        setTrades([]);
        setSelectedTradeId('');
        setDetails({});
        setRecipients([]);
        setRosterPlayers([]);
        setRosterCache({});
        setImpactLoadingUsers({});
        setRecipientUserId('');
        setOutgoingIds([]);
        setIncomingIds([]);
        setRecipientRosterPlayers([]);
        setRecipientRosterLoading(false);
        setRecipientRosterError(null);
        setCreateOptionsLoading(false);
        setCreateSubmitting(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const requestId = ++listRequestRef.current;
      try {
        const list = await fetchLeagueTrades(leagueId);
        if (!mounted || requestId !== listRequestRef.current) return;
        setTrades(list);
        setSelectedTradeId((prev) => prev || list[0]?.tradeId || '');
      } catch (err) {
        if (!mounted || requestId !== listRequestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load trades.');
      } finally {
        if (mounted && requestId === listRequestRef.current) {
          setLoading(false);
        }
      }
    };

    void fetchTrades();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  useEffect(() => {
    let mounted = true;
    const fetchRecipientRoster = async () => {
      if (!recipientUserId) {
        setRecipientRosterPlayers([]);
        setRecipientRosterLoading(false);
        setRecipientRosterError(null);
        return;
      }

      setRecipientRosterLoading(true);
      setRecipientRosterError(null);
      const requestId = ++recipientRosterRequestRef.current;

      try {
        const roster = await fetchLeagueRoster(leagueId, recipientUserId);
        if (!mounted || requestId !== recipientRosterRequestRef.current) return;
        setRecipientRosterPlayers(roster);
        setRosterCache((prev) => ({ ...prev, [recipientUserId]: roster }));
      } catch (err) {
        if (!mounted || requestId !== recipientRosterRequestRef.current) return;
        if (isHttp404Error(err)) {
          setRecipientRosterPlayers([]);
          setRosterCache((prev) => ({ ...prev, [recipientUserId]: [] }));
          setRecipientRosterError(null);
          return;
        }
        setRecipientRosterError(
          err instanceof Error ? err.message : 'Failed to load recipient roster.'
        );
      } finally {
        if (mounted && requestId === recipientRosterRequestRef.current) {
          setRecipientRosterLoading(false);
        }
      }
    };

    void fetchRecipientRoster();
    return () => {
      mounted = false;
    };
  }, [leagueId, recipientUserId]);

  useEffect(() => {
    if (!createSuccess) return;
    const timer = setTimeout(() => {
      setCreateSuccess(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [createSuccess]);

  useEffect(() => {
    setCreateSuccess(null);
  }, [recipientUserId, outgoingIds, incomingIds]);

  useEffect(() => {
    let mounted = true;
    const fetchCreateData = async () => {
      if (!currentUserId || !showCreate) return;
      setCreateOptionsLoading(true);
      const requestId = ++createRequestRef.current;
      try {
        const [members, roster] = await Promise.all([
          fetchLeagueMembers(leagueId),
          fetchLeagueRoster(leagueId, currentUserId),
        ]);
        if (!mounted || requestId !== createRequestRef.current) return;
        setLeagueMembers(members);
        setRecipients(members.filter((m) => m.userId !== currentUserId));
        setRosterPlayers(roster);
        setRosterCache((prev) => ({ ...prev, [currentUserId]: roster }));
      } catch (err) {
        if (!mounted || requestId !== createRequestRef.current) return;
        if (isHttp404Error(err)) {
          setLeagueMembers([]);
          setRecipients([]);
          setRosterPlayers([]);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load trade options.');
      } finally {
        if (mounted && requestId === createRequestRef.current) {
          setCreateOptionsLoading(false);
        }
      }
    };

    void fetchCreateData();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId, showCreate]);

  useEffect(() => {
    const incoming = preselectedIncomingPlayerId || '';
    const recipient = preselectedRecipientUserId || '';
    const signature = `${incoming}:${recipient}`;
    if (!incoming) return;
    if (prefillSignatureRef.current === signature) return;
    prefillSignatureRef.current = signature;

    setShowCreate(true);
    setCounterParentTradeId(null);
    setCreateSuccess(null);
    if (recipient) {
      setRecipientUserId(recipient);
    }
    setOutgoingIds([]);
    setIncomingIds((prev) => (prev.includes(incoming) ? prev : [incoming]));

    if (!searchParams) return;
    const hasPrefillParams = searchParams.has('tradePlayer') || searchParams.has('tradeRecipient');
    if (!hasPrefillParams) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('tradePlayer');
    nextParams.delete('tradeRecipient');
    const nextQuery = nextParams.toString();
    const targetPath = pathname || '/leagues';
    router.replace(nextQuery ? `${targetPath}?${nextQuery}` : targetPath, { scroll: false });
  }, [pathname, preselectedIncomingPlayerId, preselectedRecipientUserId, router, searchParams]);

  useEffect(() => {
    let active = true;
    const ensureRoster = async (userId: string) => {
      if (!userId || rosterCache[userId]) return;
      setImpactLoadingUsers((prev) => ({ ...prev, [userId]: true }));
      try {
        const roster = await fetchLeagueRoster(leagueId, userId);
        if (!active) return;
        setRosterCache((prev) => ({ ...prev, [userId]: roster }));
      } catch (err) {
        if (!active) return;
        if (isHttp404Error(err)) {
          setRosterCache((prev) => ({ ...prev, [userId]: [] }));
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load roster for impact.');
      } finally {
        if (active) {
          setImpactLoadingUsers((prev) => ({ ...prev, [userId]: false }));
        }
      }
    };

    if (selectedTrade) {
      void ensureRoster(selectedTrade.proposerUserId);
      void ensureRoster(selectedTrade.recipientUserId);
    }

    return () => {
      active = false;
    };
  }, [leagueId, selectedTrade, rosterCache]);

  useEffect(() => {
    let mounted = true;
    const fetchDetails = async () => {
      if (!selectedTrade) return;
      if (details[selectedTrade.tradeId]) return;
      setDetailLoading(true);
      const requestId = ++detailRequestRef.current;
      try {
        const trade = await fetchTradeDetails(selectedTrade.tradeId);
        if (!trade || !mounted || requestId !== detailRequestRef.current) return;
        setDetails((prev) => ({ ...prev, [selectedTrade.tradeId]: trade }));
        setTrades((prev) =>
          prev.map((entry) =>
            entry.tradeId === selectedTrade.tradeId ? { ...entry, ...trade } : entry
          )
        );
      } catch (err) {
        if (!mounted || requestId !== detailRequestRef.current) return;
        if (isHttp404Error(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to load trade details.');
      } finally {
        if (mounted && requestId === detailRequestRef.current) {
          setDetailLoading(false);
        }
      }
    };

    void fetchDetails();
    return () => {
      mounted = false;
    };
  }, [selectedTrade, details]);

  const refreshTrade = async (tradeId: string) => {
    try {
      const trade = await fetchTradeDetails(tradeId);
      if (!trade) return;
      setDetails((prev) => ({ ...prev, [tradeId]: trade }));
      setTrades((prev) =>
        prev.map((entry) => (entry.tradeId === tradeId ? { ...entry, ...trade } : entry))
      );
    } catch (err) {
      if (isHttp404Error(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to refresh trade.');
    }
  };

  const runActionForTrade = async (tradeId: string, action: 'accept' | 'decline' | 'cancel') => {
    const targetTrade = trades.find((trade) => trade.tradeId === tradeId);
    if (!targetTrade) return;

    setSelectedTradeId(tradeId);
    setActionLoading(true);
    setActionType(action);
    setActionTradeId(tradeId);
    setError(null);

    const previousTrade = targetTrade;
    const optimisticStatus: TradeStatus =
      action === 'accept'
        ? targetTrade.reviewMode && targetTrade.reviewMode !== 'NONE'
          ? 'REVIEW_PENDING'
          : 'EXECUTED'
        : action === 'decline'
          ? 'DECLINED'
          : 'CANCELLED';

    setTrades((prev) =>
      prev.map((trade) =>
        trade.tradeId === previousTrade.tradeId
          ? {
              ...trade,
              status: optimisticStatus,
              acceptedAt: action === 'accept' ? new Date().toISOString() : trade.acceptedAt,
              executedAt:
                optimisticStatus === 'EXECUTED' ? new Date().toISOString() : trade.executedAt,
              reviewStatus: optimisticStatus === 'REVIEW_PENDING' ? 'PENDING' : trade.reviewStatus,
            }
          : trade
      )
    );

    try {
      const requestId = createRequestId();
      await actOnTrade(tradeId, action, requestId);
      await refreshTrade(tradeId);
      const list = await fetchLeagueTrades(leagueId);
      setTrades(list);
    } catch (err) {
      setTrades((prev) =>
        prev.map((trade) =>
          trade.tradeId === previousTrade.tradeId
            ? {
                ...trade,
                status: previousTrade.status,
                acceptedAt: previousTrade.acceptedAt,
                executedAt: previousTrade.executedAt,
                reviewStatus: previousTrade.reviewStatus,
              }
            : trade
        )
      );
      try {
        await refreshTrade(tradeId);
        const list = await fetchLeagueTrades(leagueId);
        setTrades(list);
      } catch {
        // Keep the original action failure visible; polling or manual refresh can recover later.
      }
      setError(mapTradeUiError(err, 'Trade action failed.'));
    } finally {
      setActionLoading(false);
      setActionType(null);
      setActionTradeId(null);
    }
  };

  const runAction = async (action: 'accept' | 'decline' | 'cancel') => {
    if (!selectedTrade) return;
    await runActionForTrade(selectedTrade.tradeId, action);
  };

  const runReviewAction = async (action: TradeReviewAction) => {
    if (!selectedTrade) return;

    setSelectedTradeId(selectedTrade.tradeId);
    setReviewActionLoading(action);
    setError(null);

    try {
      const requestId = createRequestId();
      await submitTradeReviewAction({ tradeId: selectedTrade.tradeId, action, requestId });
      await refreshTrade(selectedTrade.tradeId);
      const list = await fetchLeagueTrades(leagueId);
      setTrades(list);
    } catch (err) {
      setError(mapTradeUiError(err, 'Trade review action failed.'));
    } finally {
      setReviewActionLoading(null);
    }
  };

  const submitTrade = async () => {
    if (!currentUserId) return;
    setError(null);

    if (!recipientUserId) {
      setError('Select a recipient.');
      return;
    }
    if (outgoingIds.length === 0) {
      setError('Select at least one outgoing player.');
      return;
    }
    if (incomingIds.length === 0) {
      setError('Select at least one incoming player.');
      return;
    }

    const combined = [...outgoingIds, ...incomingIds];
    const unique = new Set(combined);
    if (unique.size !== combined.length) {
      setError('Players cannot be selected in both lists.');
      return;
    }

    setCreateSubmitting(true);
    try {
      const items = [
        ...outgoingIds.map((playerId) => ({
          fromUserId: currentUserId,
          toUserId: recipientUserId,
          playerId,
        })),
        ...incomingIds.map((playerId) => ({
          fromUserId: recipientUserId,
          toUserId: currentUserId,
          playerId,
        })),
      ];

      const requestId = createRequestId();
      const tradeId = await submitTradeRequest({
        requestId,
        leagueId,
        recipientUserId,
        parentTradeId: counterParentTradeId,
        items,
      });
      const list = await fetchLeagueTrades(leagueId);
      setTrades(list);
      const nextSelected = tradeId || list[0]?.tradeId || '';
      setSelectedTradeId(nextSelected);

      if (tradeId) {
        const newTrade = await fetchTradeDetails(tradeId);
        if (newTrade) {
          setDetails((prev) => ({ ...prev, [tradeId]: newTrade }));
        }
      }

      setOutgoingIds([]);
      setIncomingIds([]);
      setRecipientUserId('');
      setCounterParentTradeId(null);
      setCreateSuccess('Trade proposed.');
      setShowCreate(false);
    } catch (err) {
      setError(mapTradeUiError(err, 'Failed to submit trade.'));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const beginCounter = async () => {
    if (!selectedTrade || !currentUserId) return;
    setShowCreate(true);
    setCreateSuccess(null);
    setCounterParentTradeId(selectedTrade.tradeId);
    setRecipientUserId(selectedTrade.proposerUserId);
    setRecipientRosterPlayers([]);
    setDetailLoading(true);
    try {
      const trade = selectedDetails ?? (await fetchTradeDetails(selectedTrade.tradeId));
      if (!trade) {
        setError('Failed to load trade details for counter.');
        return;
      }
      setDetails((prev) => ({ ...prev, [selectedTrade.tradeId]: trade }));
      setOutgoingIds(
        trade.items.filter((item) => item.fromUserId === currentUserId).map((item) => item.playerId)
      );
      setIncomingIds(
        trade.items.filter((item) => item.toUserId === currentUserId).map((item) => item.playerId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trade details for counter.');
    } finally {
      setDetailLoading(false);
    }
  };

  const clearCounter = () => {
    setCounterParentTradeId(null);
    setRecipientUserId('');
    setOutgoingIds([]);
    setIncomingIds([]);
    setRecipientRosterPlayers([]);
  };

  return {
    showCreate,
    setShowCreate,
    loading,
    error,
    inboxStatusFilter,
    setInboxStatusFilter,
    filteredIncomingTrades,
    filteredOutgoingTrades,
    selectedTrade,
    selectedDetails,
    details,
    teamNameByUserId,
    setSelectedTradeId,
    pendingIncomingCount,
    pendingOutgoingCount,
    closedTradeCount,

    detailLoading,
    gives,
    receives,
    rosterCache,
    visibleKeys,
    labels,
    reviewNetImpact,
    reviewTopGains,
    reviewTopRisks,
    reviewImpactLoading,
    reviewImpact,
    acceptEnabled,
    declineEnabled,
    counterEnabled,
    cancelEnabled,
    actionLoading,
    actionType,
    actionTradeId,
    runAction,
    runActionForTrade,
    beginCounter,
    reviewControls: {
      approveEnabled: approveReviewEnabled,
      rejectEnabled: rejectReviewEnabled,
      vetoEnabled: vetoReviewEnabled,
      finalizeEnabled: finalizeReviewEnabled,
      loadingAction: reviewActionLoading,
      onApprove: () => runReviewAction('approve-review'),
      onReject: () => runReviewAction('reject-review'),
      onVeto: () => runReviewAction('veto'),
      onFinalize: () => runReviewAction('finalize-review'),
    },

    createOptionsLoading,
    createSubmitting,
    recipients,
    recipientUserId,
    selectedRecipientName,
    missingRecipient,
    createStep,
    allKeys,
    defaultKeys,
    createSuccess,
    counterParentTradeId,
    rosterPlayers,
    outgoingIds,
    incomingIds,
    missingOutgoing,
    missingIncoming,
    recipientRosterPlayers,
    recipientRosterLoading,
    recipientRosterError,
    outgoingPlayers,
    incomingPlayers,
    createTopGains,
    createTopRisks,
    createImpact,
    createNetImpact,
    submitDisabled,
    toggleKey,
    clearCounter,
    setRecipientUserId,
    setIncomingIds,
    setRecipientRosterPlayers,
    setOutgoingIds,
    setConfirmCreate,
    confirmCreate,
    createSummary,
    submitTrade,
  };
}
