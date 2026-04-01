import { describe, expect, it } from 'vitest';

import {
  buildTradeActivityPrompt,
  formatNetImpact,
  formatRelativeTradeTime,
  formatStatValue,
  getDeltaClass,
  isTradeActive,
  isTradeAwaitingManagerAction,
  mapTradeUiError,
} from './tradeUiUtils';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';

describe('tradeUiUtils', () => {
  it('maps TRADE_PLAYER_LOCKED to a friendly message', () => {
    const err = new Error(
      'HTTP 409 Conflict - One or more players are already locked in another trade. - code=TRADE_PLAYER_LOCKED'
    );
    expect(mapTradeUiError(err, 'fallback')).toContain('already in another active trade');
  });

  it('maps generic HTTP 409 to the same friendly message', () => {
    const err = new Error('HTTP 409 Conflict');
    expect(mapTradeUiError(err, 'fallback')).toContain('already in another active trade');
  });

  it('returns original message when no known mapping exists', () => {
    const err = new Error('Something else failed');
    expect(mapTradeUiError(err, 'fallback')).toBe('Something else failed');
  });

  it('treats review-pending trades as active but not awaiting manager acceptance', () => {
    expect(isTradeActive({ status: 'REVIEW_PENDING' })).toBe(true);
    expect(isTradeAwaitingManagerAction({ status: 'REVIEW_PENDING' })).toBe(false);
    expect(isTradeAwaitingManagerAction({ status: 'PROPOSED' })).toBe(true);
  });

  it('formats net impact with sign and two decimals', () => {
    const result = formatNetImpact(
      { kicks: 1.234, marks: -0.234 },
      ['kicks', 'marks'] as CanonicalStatKey[]
    );
    expect(result.net).toBeCloseTo(1, 5);
    expect(result.label).toBe('+1.00');
  });

  it('formats stat values safely', () => {
    expect(formatStatValue(null)).toBe('-');
    expect(formatStatValue('')).toBe('-');
    expect(formatStatValue(12)).toBe('12');
    expect(formatStatValue(12.34)).toBe('12.3');
  });

  it('returns correct delta class', () => {
    expect(getDeltaClass(1)).toContain('emerald');
    expect(getDeltaClass(-1)).toContain('rose');
    expect(getDeltaClass(0)).toContain('slate');
  });

  it('formats compact relative trade times', () => {
    expect(
      formatRelativeTradeTime('2026-03-23T09:50:00.000Z', Date.parse('2026-03-23T10:02:00.000Z'))
    ).toBe('12m ago');
  });

  it('builds sent prompts for pending outgoing offers', () => {
    const prompt = buildTradeActivityPrompt({
      trade: {
        tradeId: 'trade-1',
        proposerUserId: 'user-1',
        recipientUserId: 'user-2',
        status: 'PROPOSED',
        createdAt: '2026-03-23T09:50:00.000Z',
        latestActivityAt: '2026-03-23T09:50:00.000Z',
        latestActivityEvent: 'TRADE_PROPOSED',
        latestActivityActorUserId: 'user-1',
      },
      currentUserId: 'user-1',
      teamNameByUserId: new Map([['user-2', 'Dockside FC']]),
      nowMs: Date.parse('2026-03-23T10:02:00.000Z'),
    });

    expect(prompt).toEqual({
      label: 'Sent 12m ago',
      tone: 'primary',
    });
  });

  it('builds countered prompts from latest trade audit activity', () => {
    const prompt = buildTradeActivityPrompt({
      trade: {
        tradeId: 'trade-1',
        proposerUserId: 'user-1',
        recipientUserId: 'user-2',
        status: 'SUPERSEDED',
        createdAt: '2026-03-23T09:00:00.000Z',
        latestActivityAt: '2026-03-23T10:00:00.000Z',
        latestActivityEvent: 'TRADE_COUNTERED',
        latestActivityActorUserId: 'user-2',
      },
      currentUserId: 'user-1',
      teamNameByUserId: new Map([['user-2', 'Dockside FC']]),
      nowMs: Date.parse('2026-03-23T10:12:00.000Z'),
    });

    expect(prompt).toEqual({
      label: 'Countered 12m ago',
      tone: 'neutral',
    });
  });

  it('builds viewed prompts when the recipient has opened a pending outgoing trade', () => {
    const prompt = buildTradeActivityPrompt({
      trade: {
        tradeId: 'trade-1',
        proposerUserId: 'user-1',
        recipientUserId: 'user-2',
        status: 'PROPOSED',
        createdAt: '2026-03-23T09:00:00.000Z',
        latestActivityAt: '2026-03-23T09:00:00.000Z',
        latestActivityEvent: 'TRADE_PROPOSED',
        latestActivityActorUserId: 'user-1',
        recipientViewedAt: '2026-03-23T10:08:00.000Z',
      },
      currentUserId: 'user-1',
      teamNameByUserId: new Map([['user-2', 'Dockside FC']]),
      nowMs: Date.parse('2026-03-23T10:12:00.000Z'),
    });

    expect(prompt).toEqual({
      label: 'Viewed by Dockside FC 4m ago',
      tone: 'neutral',
    });
  });

  it('builds review prompts for trades awaiting league approval', () => {
    const prompt = buildTradeActivityPrompt({
      trade: {
        tradeId: 'trade-1',
        proposerUserId: 'user-1',
        recipientUserId: 'user-2',
        status: 'REVIEW_PENDING',
        createdAt: '2026-03-23T09:00:00.000Z',
        latestActivityAt: '2026-03-23T10:00:00.000Z',
        latestActivityEvent: 'TRADE_REVIEW_REQUESTED',
        latestActivityActorUserId: 'user-2',
      },
      currentUserId: 'user-1',
      teamNameByUserId: new Map([['user-2', 'Dockside FC']]),
      nowMs: Date.parse('2026-03-23T10:12:00.000Z'),
    });

    expect(prompt).toEqual({
      label: 'Sent to review 12m ago',
      tone: 'warning',
    });
  });
});
