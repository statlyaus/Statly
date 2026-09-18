import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePromotionBackedFactualReleaseSchema } from '../outcomes/promotionBackedFactualReleaseContracts';
import { loadCurrentAflTradePostseasonContext } from '../modeling/postgresPostseasonContextAuthority';
import {
  AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
  aflTradePrivateValuationCohortBindingSchema,
  type AflTradePrivateValuationCohortBinding,
} from './postgresPrivateValuationCohortBinding';

const requestSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: aflTradeSha256Schema,
      })
      .strict(),
  })
  .strict();
const historicalRequestSchema = requestSchema
  .extend({
    reviewDecisionId: z.string().trim().min(1).max(240),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const evidenceSchema = z
  .object({
    binding: aflTradePrivateValuationCohortBindingSchema,
    releaseManifest: aflTradePromotionBackedFactualReleaseSchema,
    members: z
      .array(
        z
          .object({
            membership: z.unknown(),
            recordSha256: aflTradeSha256Schema,
            recordCanonicalJson: z.string().min(1),
          })
          .strict()
      )
      .min(1)
      .max(1_000_000),
  })
  .strict();

const snapshotSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-canonical-release-member/v1'),
    recordKind: z.string(),
    record: z.record(z.string(), z.unknown()),
  })
  .strict();

const recordIdentityFields = {
  transaction: 'eventVersionId',
  draft_event: 'eventVersionId',
  transfer: 'assetVersionId',
  draft_player_asset: 'assetVersionId',
  draft_selection: 'selectionId',
  pick_custody: 'custodyObservationId',
  pick_realization: 'realizationId',
} as const;

function requireRecordIdentity(
  record: Record<string, unknown>,
  membership: z.infer<
    typeof aflTradePromotionBackedFactualReleaseSchema
  >['content']['canonicalMembers'][number],
  binding: AflTradePrivateValuationCohortBinding
) {
  if (
    record[recordIdentityFields[membership.recordKind]] !== membership.canonicalRecordId ||
    record.status !== 'approved'
  ) {
    throw new TypeError('Private trade evidence has mismatched record identity or status.');
  }
  if (
    ['transaction', 'draft_event', 'pick_custody', 'pick_realization'].includes(
      membership.recordKind
    )
  ) {
    const recordedAt = z.iso.datetime({ offset: true }).parse(record.recordedAt);
    if (Date.parse(recordedAt) > Date.parse(binding.effectiveThrough))
      throw new TypeError('Private trade record is known after its cohort cutoff.');
  }
  if (membership.recordKind === 'transaction') {
    if ('schemaVersion' in binding) {
      const postseason = binding.postseasonYearContexts[0].content;
      const eventDate = z.union([z.iso.date(), z.null()]).parse(record.eventDate);
      if (
        record.competition !== 'AFLM' ||
        record.seasonYear !== binding.tradeYear ||
        record.eventId !== AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID ||
        record.eventVersionId !== binding.cohortTradeIds[0] ||
        record.kind !== 'trade' ||
        eventDate !== postseason.tradeDate
      ) {
        throw new TypeError('Private trade record is not the reviewed historical pilot.');
      }
    } else {
      const eventDate = z.iso.date().parse(record.eventDate);
      if (
        record.competition !== 'AFLM' ||
        record.seasonYear !== 2025 ||
        record.kind !== 'trade' ||
        eventDate > binding.effectiveThrough.slice(0, 10)
      ) {
        throw new TypeError('Private trade record is not an admitted 2025 transaction.');
      }
    }
  }
}

function verifyEvidence(input: z.infer<typeof requestSchema>, rawEvidence: unknown) {
  const evidence = evidenceSchema.parse(rawEvidence);
  const { binding, releaseManifest: release } = evidence;
  if (
    binding.requestId !== input.requestId ||
    release.releaseId !== binding.cohortReleaseId ||
    release.content.environment !== 'non_production' ||
    release.content.competition !== 'AFLM' ||
    release.content.scopeKey !== binding.cohortScopeKey ||
    release.content.corpusId !== binding.corpusId ||
    release.content.effectiveThrough !== binding.effectiveThrough ||
    release.content.sourceMemberSetSha256 !== binding.sourceMemberSetSha256 ||
    release.content.canonicalMemberSetSha256 !== binding.canonicalMemberSetSha256 ||
    release.content.sourceCaptureSetSha256 !== binding.sourceCaptureSetSha256 ||
    release.content.promotionSourceSetSha256 !== binding.promotionSourceSetSha256
  ) {
    throw new TypeError('Private trade evidence does not match the selected cohort.');
  }
  if (evidence.members.length !== release.content.canonicalMembers.length) {
    throw new TypeError('Private trade evidence has incomplete sealed membership.');
  }
  const members = evidence.members.map((member, index) => {
    const selected = release.content.canonicalMembers[index]!;
    const decoded: unknown = JSON.parse(member.recordCanonicalJson);
    if (
      canonicalizeAflTradeJson(member.membership) !== canonicalizeAflTradeJson(selected) ||
      member.recordSha256 !== selected.canonicalRecordSha256 ||
      createHash('sha256').update(member.recordCanonicalJson, 'utf8').digest('hex') !==
        member.recordSha256 ||
      canonicalizeAflTradeJson(decoded) !== member.recordCanonicalJson
    ) {
      throw new TypeError('Private trade evidence has mismatched sealed membership or bytes.');
    }
    const snapshot = snapshotSchema.parse(decoded);
    if (snapshot.recordKind !== selected.recordKind) {
      throw new TypeError('Private trade evidence has a substituted record kind.');
    }
    requireRecordIdentity(snapshot.record, selected, binding);
    return { ...member, membership: selected, ...snapshot };
  });
  const trades = members
    .filter(({ recordKind }) => recordKind === 'transaction')
    .map(({ record }) => ({
      eventVersionId: z.string().min(1).parse(record.eventVersionId),
      eventId: z.string().min(1).parse(record.eventId),
    }));
  if (
    canonicalizeAflTradeJson(trades.map(({ eventVersionId }) => eventVersionId)) !==
      canonicalizeAflTradeJson(binding.cohortTradeIds) ||
    new Set(trades.map(({ eventId }) => eventId)).size !== trades.length ||
    ('schemaVersion' in binding &&
      (trades.length !== 1 || trades[0]!.eventId !== binding.cohortTransactionId))
  ) {
    throw new TypeError('Private trade evidence does not contain the exact unambiguous cohort.');
  }
  return { ...evidence, members, trades };
}

/**
 * Read sealed source records for the independently admitted private cohort. The database owns
 * current claim/source/Gate authority. This reader preserves source timestamps; it does not
 * infer custody duration, historical knowledge, contribution periods, or forecast permission.
 */
export class PostgresAflTradePrivateValuationTradeEvidence {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly evidence?: AflTradeAcquisitionRegistrationEvidenceReader,
    private readonly postseasonContextLoader: typeof loadCurrentAflTradePostseasonContext = loadCurrentAflTradePostseasonContext
  ) {}

  async load(unparsed: z.input<typeof requestSchema>) {
    const input = requestSchema.parse(unparsed);
    return this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const result = await transaction.query<{ evidence_json: unknown }>(
        'SELECT load_outcome_private_valuation_trade_evidence($1,$2,$3) AS evidence_json',
        [
          input.requestId,
          input.claim.claimId,
          createHash('sha256').update(input.claim.leaseToken, 'utf8').digest('hex'),
        ]
      );
      if (result.rows.length !== 1)
        throw new TypeError('Private trade evidence is unavailable or ambiguous.');
      return verifyEvidence(input, result.rows[0]!.evidence_json);
    });
  }

  async loadHistoricalPilot(unparsed: z.input<typeof historicalRequestSchema>) {
    const input = historicalRequestSchema.parse(unparsed);
    if (this.evidence === undefined) {
      throw new TypeError('Historical trade evidence requires physical review evidence.');
    }
    const physicalEvidence = this.evidence;
    return this.client.transaction(async (transaction) => {
      const leaseSha256 = createHash('sha256').update(input.claim.leaseToken, 'utf8').digest('hex');
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `outcome-private-cohort-binding:${input.requestId}`,
      ]);
      await transaction.query(
        'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
        [input.requestId, input.claim.claimId, leaseSha256]
      );
      const selection = await this.postseasonContextLoader(
        transaction,
        {
          reviewDecisionId: input.reviewDecisionId,
          environment: 'non_production',
          knowledgeCutoffAt: input.knowledgeCutoffAt,
        },
        physicalEvidence
      );
      if (
        selection.context.content.tradeId !== AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID ||
        selection.context.content.tradeYear !== 2020
      ) {
        throw new TypeError('Reviewed postseason context is not the exact historical pilot.');
      }
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const result = await transaction.query<{ evidence_json: unknown }>(
        `SELECT load_outcome_private_valuation_historical_trade_evidence(
          $1,$2,$3,$4::jsonb) AS evidence_json`,
        [input.requestId, input.claim.claimId, leaseSha256, JSON.stringify(selection.context)]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Historical trade evidence is unavailable or ambiguous.');
      }
      return verifyEvidence(input, result.rows[0]!.evidence_json);
    });
  }
}
