import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import { aflTradePostseasonYearContextSchema } from '../domain/postseasonYearContext';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { loadCurrentAflTradePostseasonContext } from '../modeling/postgresPostseasonContextAuthority';

export const AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY =
  'afl-men:historical-pilot:2020-jeremy-cameron' as const;
export const AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID =
  'external-transaction:40cb6950856a32a389022fa2dfb2e7c988781ca6646a0dfaa56387e13f4a408b' as const;

const claimInputSchema = z.object({
  requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
  claim: z
    .object({
      claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
      leaseToken: aflTradeSha256Schema,
    })
    .strict(),
});
const selectionSchema = claimInputSchema
  .extend({
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
  })
  .strict();
const historicalPilotSelectionSchema = selectionSchema
  .extend({
    reviewDecisionId: z.string().trim().min(1).max(240),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const aflTradePrivateValuationLegacyCohortBindingSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    factualOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    privateFactualCandidateId: aflTradeContentAddressedIdSchema('private-factual-candidate'),
    privateFactualRevision: z.number().int().positive(),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    cohortCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    cohortReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    cohortScopeKey: z.literal('afl-men:2025-trades'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    sourceCaptureSetSha256: aflTradeSha256Schema,
    promotionSourceSetSha256: aflTradeSha256Schema,
    effectiveThrough: z.iso.datetime({ offset: true }),
    cohortTradeIds: z.array(z.string().trim().min(1).max(1000)).min(1).max(100_000),
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.cohortTradeIds.some(
        (id, index) => index > 0 && binding.cohortTradeIds[index - 1]! >= id
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cohortTradeIds'],
        message: 'Cohort transaction identifiers must be unique and canonically ordered.',
      });
    }
  });

const historicalFactualAuthorityContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-private-historical-factual-authority/v1'),
    authorityBoundary: z.literal('promotion_backed_postseason_factual_only'),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    cohortScopeKey: z.literal(AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    cohortReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    reviewDecisionId: z.string().trim().min(1).max(240),
    postseasonContextId: aflTradeContentAddressedIdSchema('postseason-year-context'),
    transactionId: z.literal(AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID),
    eventVersionId: z.string().trim().min(1).max(1000),
    tradeYear: z.literal(2020),
    revision: z.literal(1),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const aflTradePrivateHistoricalFactualAuthoritySchema = z
  .object({
    authorityId: aflTradeContentAddressedIdSchema('private-valuation-historical-factual-authority'),
    content: historicalFactualAuthorityContentSchema,
  })
  .strict()
  .superRefine((authority, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-historical-factual-authority',
      authority.authorityId,
      authority.content,
      context,
      ['authorityId']
    );
  });

export const aflTradePrivateValuationHistoricalPilotCohortBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-private-valuation-cohort-binding/v2'),
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    historicalFactualAuthority: aflTradePrivateHistoricalFactualAuthoritySchema,
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    cohortCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    cohortReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    cohortScopeKey: z.literal(AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    sourceCaptureSetSha256: aflTradeSha256Schema,
    promotionSourceSetSha256: aflTradeSha256Schema,
    effectiveThrough: z.iso.datetime({ offset: true }),
    cohortTransactionId: z.literal(AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID),
    tradeYear: z.literal(2020),
    cohortTradeIds: z.tuple([z.string().trim().min(1).max(1000)]),
    postseasonYearContexts: z.tuple([aflTradePostseasonYearContextSchema]),
  })
  .strict()
  .superRefine((binding, context) => {
    const authority = binding.historicalFactualAuthority.content;
    const postseason = binding.postseasonYearContexts[0];
    const mismatched =
      authority.requestId !== binding.requestId ||
      authority.cohortScopeKey !== binding.cohortScopeKey ||
      authority.lineageAdmissionId !== binding.lineageAdmissionId ||
      authority.cohortReleaseId !== binding.cohortReleaseId ||
      authority.postseasonContextId !== postseason.contextId ||
      authority.transactionId !== binding.cohortTransactionId ||
      authority.eventVersionId !== binding.cohortTradeIds[0] ||
      authority.tradeYear !== binding.tradeYear ||
      authority.reviewDecisionId !== postseason.content.reviewDecisionId ||
      authority.knowledgeCutoffAt !== postseason.content.knowledgeCutoffAt ||
      postseason.content.environment !== 'non_production' ||
      postseason.content.competition !== 'AFLM' ||
      postseason.content.tradeId !== binding.cohortTransactionId ||
      postseason.content.eventVersionId !== binding.cohortTradeIds[0] ||
      postseason.content.tradeYear !== binding.tradeYear ||
      postseason.content.tradeId === postseason.content.eventVersionId;
    if (mismatched) {
      context.addIssue({
        code: 'custom',
        message: 'Historical pilot factual authority, member and postseason context differ.',
      });
    }
  });

export const aflTradePrivateValuationCohortBindingSchema = z.union([
  aflTradePrivateValuationLegacyCohortBindingSchema,
  aflTradePrivateValuationHistoricalPilotCohortBindingSchema,
]);

export type AflTradePrivateValuationCohortBinding = z.infer<
  typeof aflTradePrivateValuationCohortBindingSchema
>;

type PostseasonContextLoader = typeof loadCurrentAflTradePostseasonContext;

/** Select existing admitted target-cohort custody; never construct or approve source authority. */
export class PostgresAflTradePrivateValuationCohortBinding {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly evidence?: AflTradeAcquisitionRegistrationEvidenceReader,
    private readonly postseasonContextLoader: PostseasonContextLoader = loadCurrentAflTradePostseasonContext
  ) {}

  async bind(
    input: z.input<typeof selectionSchema>
  ): Promise<AflTradePrivateValuationCohortBinding> {
    const selection = selectionSchema.parse(input);
    const binding = await this.read(selection, selection.lineageAdmissionId);
    if (binding === null) throw new TypeError('Cohort selection was not retained.');
    if (binding.lineageAdmissionId !== selection.lineageAdmissionId) {
      throw new TypeError('Cohort binding names another selected lineage admission.');
    }
    return binding;
  }

  async load(
    input: z.input<typeof claimInputSchema>
  ): Promise<AflTradePrivateValuationCohortBinding | null> {
    return this.read(claimInputSchema.parse(input));
  }

  async bindHistoricalPilot(
    input: z.input<typeof historicalPilotSelectionSchema>
  ): Promise<z.infer<typeof aflTradePrivateValuationHistoricalPilotCohortBindingSchema>> {
    const binding = await this.readHistorical(historicalPilotSelectionSchema.parse(input));
    if (binding === null) throw new TypeError('Historical cohort selection was not retained.');
    return binding;
  }

  async loadHistoricalPilot(
    input: z.input<typeof historicalPilotSelectionSchema>
  ): Promise<z.infer<typeof aflTradePrivateValuationHistoricalPilotCohortBindingSchema> | null> {
    return this.readHistorical(historicalPilotSelectionSchema.parse(input), true);
  }

  private async read(input: z.infer<typeof claimInputSchema>, lineageAdmissionId?: string) {
    return this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const claimParameters = [
        input.requestId,
        input.claim.claimId,
        createHash('sha256').update(input.claim.leaseToken, 'utf8').digest('hex'),
      ];
      if (lineageAdmissionId === undefined) {
        await transaction.query(
          'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
          claimParameters
        );
      }
      const result = await transaction.query<{ readonly binding_json: unknown }>(
        lineageAdmissionId === undefined
          ? 'SELECT load_outcome_private_valuation_cohort_input($1) AS binding_json'
          : 'SELECT bind_outcome_private_valuation_cohort_input($1,$2,$3,$4) AS binding_json',
        lineageAdmissionId === undefined
          ? [input.requestId]
          : [...claimParameters, lineageAdmissionId]
      );
      if (result.rows.length !== 1) throw new TypeError('Cohort authority lookup is ambiguous.');
      if (result.rows[0]!.binding_json === null) return null;
      const binding = aflTradePrivateValuationCohortBindingSchema.parse(
        result.rows[0]!.binding_json
      );
      if (binding.requestId !== input.requestId)
        throw new TypeError('Cohort binding belongs to another request.');
      return binding;
    });
  }

  private async readHistorical(
    input: z.infer<typeof historicalPilotSelectionSchema>,
    loadOnly = false
  ) {
    if (this.evidence === undefined) {
      throw new TypeError('Historical cohort selection requires physical review evidence.');
    }
    const evidence = this.evidence;
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
        evidence
      );
      const context = selection.context;
      if (
        context.content.tradeId !== AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID ||
        context.content.tradeYear !== 2020 ||
        context.content.environment !== 'non_production'
      ) {
        throw new TypeError('Reviewed postseason context is not the exact historical pilot.');
      }
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const result = await transaction.query<{ readonly binding_json: unknown }>(
        loadOnly
          ? 'SELECT load_outcome_private_valuation_historical_cohort_input($1,$2,$3,$4::jsonb) AS binding_json'
          : 'SELECT bind_outcome_private_valuation_historical_cohort_input($1,$2,$3,$4,$5::jsonb) AS binding_json',
        loadOnly
          ? [input.requestId, input.claim.claimId, leaseSha256, JSON.stringify(context)]
          : [
              input.requestId,
              input.claim.claimId,
              leaseSha256,
              input.lineageAdmissionId,
              JSON.stringify(context),
            ]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Historical cohort authority lookup is ambiguous.');
      }
      if (result.rows[0]!.binding_json === null) return null;
      const binding = aflTradePrivateValuationHistoricalPilotCohortBindingSchema.parse(
        result.rows[0]!.binding_json
      );
      if (
        binding.requestId !== input.requestId ||
        binding.lineageAdmissionId !== input.lineageAdmissionId ||
        binding.postseasonYearContexts[0].contextId !== context.contextId
      ) {
        throw new TypeError('Historical cohort binding differs from the selected authority.');
      }
      return binding;
    });
  }
}
