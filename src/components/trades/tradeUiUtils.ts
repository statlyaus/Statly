import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import type { TradeSummary } from '@/components/trades/tradeApi';

export function isTradeAwaitingManagerAction(trade: Pick<TradeSummary, 'status'>): boolean {
  return trade.status === 'PROPOSED';
}

export function isTradeActive(trade: Pick<TradeSummary, 'status'>): boolean {
  return trade.status === 'PROPOSED' || trade.status === 'REVIEW_PENDING';
}

export function mapTradeUiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message || '';
  const codeMatch = message.match(/code=([A-Z0-9_]+)/i);
  const code = codeMatch?.[1]?.toUpperCase() ?? '';

  if (code === 'TRADE_PLAYER_LOCKED') {
    return 'Some selected players are already in another active trade. Remove those players or wait for that trade to resolve, then submit again.';
  }
  if (code === 'TRADE_INVALID_TRANSITION') {
    return 'This trade changed before your action completed. The latest trade state has been refreshed.';
  }
  if (code === 'TRADE_IDEMPOTENCY_CONFLICT') {
    return 'This trade action was already processed. The latest trade state has been refreshed.';
  }
  if (code === 'TRADE_LIMIT_REACHED') {
    return 'This move would exceed the trade limit configured for one of the teams in this league.';
  }
  if (code === 'TRADE_WINDOW_CLOSED') {
    return 'Trading is currently closed for this league.';
  }
  if (code === 'TRADE_INVALID_PAYLOAD') {
    return 'This trade offer is invalid. Review the players and teams involved, then submit again.';
  }
  if (/HTTP\s*409/i.test(message)) {
    return 'This trade changed before your action completed. The latest trade state has been refreshed.';
  }

  return message || fallback;
}

export function getDeltaClass(delta: number) {
  if (delta > 0) return 'text-success bg-success/10 ring-1 ring-success';
  if (delta < 0) return 'text-destructive bg-destructive/10 ring-1 ring-destructive';
  return 'text-muted-foreground bg-muted ring-1 ring-ring';
}

export function formatNetImpact(deltaTotals: Record<string, number>, keys: CanonicalStatKey[]) {
  const net = keys.reduce((sum, key) => sum + (deltaTotals[key] ?? 0), 0);
  const sign = net > 0 ? '+' : '';
  const rounded = Number.isFinite(net) ? net.toFixed(2) : '0.00';
  return { net, label: `${sign}${rounded}` };
}

export function formatStatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
    return Number.isInteger(asNumber) ? String(asNumber) : asNumber.toFixed(1);
  }
  return String(value);
}

export function formatRelativeTradeTime(value: string, nowMs = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'just now';

  const deltaMs = Math.max(0, nowMs - timestamp);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function buildTradeActivityPrompt(input: {
  trade: TradeSummary;
  currentUserId: string | null;
  teamNameByUserId: Map<string, string>;
  nowMs?: number;
}): { label: string; tone: 'primary' | 'warning' | 'success' | 'danger' | 'neutral' } {
  const { trade, currentUserId, teamNameByUserId, nowMs = Date.now() } = input;
  const latestActivityAt = trade.latestActivityAt ?? trade.createdAt;
  const relative = formatRelativeTradeTime(latestActivityAt, nowMs);
  const actorName =
    trade.latestActivityActorUserId && trade.latestActivityActorUserId !== currentUserId
      ? (teamNameByUserId.get(trade.latestActivityActorUserId) ?? 'Opponent')
      : 'You';
  const event = trade.latestActivityEvent ?? 'TRADE_PROPOSED';
  const isRecipient = trade.recipientUserId === currentUserId;
  const isProposer = trade.proposerUserId === currentUserId;
  const counterpartUserId = isProposer ? trade.recipientUserId : trade.proposerUserId;
  const counterpartName = teamNameByUserId.get(counterpartUserId) ?? 'Opponent';
  const counterpartViewedAt = isProposer ? trade.recipientViewedAt : trade.proposerViewedAt;
  const counterpartViewedMs = counterpartViewedAt ? Date.parse(counterpartViewedAt) : Number.NaN;
  const latestActivityMs = Date.parse(latestActivityAt);

  if (
    isTradeAwaitingManagerAction(trade) &&
    isProposer &&
    Number.isFinite(counterpartViewedMs) &&
    (!Number.isFinite(latestActivityMs) || counterpartViewedMs >= latestActivityMs)
  ) {
    return {
      label: `Viewed by ${counterpartName} ${formatRelativeTradeTime(counterpartViewedAt!, nowMs)}`,
      tone: 'neutral',
    };
  }

  switch (event) {
    case 'TRADE_COUNTERED':
      return { label: `Countered ${relative}`, tone: 'neutral' };
    case 'TRADE_REVIEW_REQUESTED':
      return { label: `Sent to review ${relative}`, tone: 'warning' };
    case 'TRADE_REVIEW_APPROVED':
      return { label: `Review approved ${relative}`, tone: 'success' };
    case 'TRADE_REVIEW_REJECTED':
      return { label: `Review rejected ${relative}`, tone: 'danger' };
    case 'TRADE_REVIEW_VOTE_CAST':
      return { label: `Review vote recorded ${relative}`, tone: 'neutral' };
    case 'TRADE_DECLINED':
      return {
        label:
          trade.latestActivityActorUserId === currentUserId
            ? `Declined ${relative}`
            : `Declined by ${actorName} ${relative}`,
        tone: 'danger',
      };
    case 'TRADE_CANCELLED':
      return {
        label:
          trade.latestActivityActorUserId === currentUserId
            ? `Retracted ${relative}`
            : `Retracted by ${actorName} ${relative}`,
        tone: 'danger',
      };
    case 'TRADE_ACCEPTED':
    case 'TRADE_EXECUTED':
      return { label: `Completed ${relative}`, tone: 'success' };
    case 'TRADE_PROPOSED':
    default:
      if (trade.status === 'REVIEW_PENDING') {
        return { label: `Under review ${relative}`, tone: 'warning' };
      }
      if (trade.status === 'REVIEW_REJECTED') {
        return { label: `Review rejected ${relative}`, tone: 'danger' };
      }
      if (trade.status === 'PROPOSED' && isProposer) {
        return { label: `Sent ${relative}`, tone: 'primary' };
      }
      if (trade.status === 'PROPOSED' && isRecipient) {
        return { label: `Received ${relative}`, tone: 'warning' };
      }
      return { label: `Updated ${relative}`, tone: 'neutral' };
  }
}
