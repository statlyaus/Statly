import { z } from 'zod';

const supportedScopeSchema = z.enum(['afl-men:2025-trades', 'afl-men:2026-trades']);

export type AflTradePrivateValuationHpnScopeKey = z.infer<typeof supportedScopeSchema>;

export type AflTradePrivateValuationHpnScopePolicy = Readonly<{
  scopeKey: AflTradePrivateValuationHpnScopeKey;
  competition: 'AFLM';
  seasonYear: 2025 | 2026;
}>;

const POLICIES: Readonly<
  Record<AflTradePrivateValuationHpnScopeKey, AflTradePrivateValuationHpnScopePolicy>
> = {
  'afl-men:2025-trades': {
    scopeKey: 'afl-men:2025-trades',
    competition: 'AFLM',
    seasonYear: 2025,
  },
  'afl-men:2026-trades': {
    scopeKey: 'afl-men:2026-trades',
    competition: 'AFLM',
    seasonYear: 2026,
  },
};

export function requireAflTradePrivateValuationHpnScopePolicy(
  scopeKey: string
): AflTradePrivateValuationHpnScopePolicy {
  const parsed = supportedScopeSchema.safeParse(scopeKey);
  if (!parsed.success) {
    throw new TypeError(`HPN preparation does not support ${scopeKey}.`);
  }
  return POLICIES[parsed.data];
}
