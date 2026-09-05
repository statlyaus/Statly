import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeAdmittedPlayerFactualOutputContentSchema,
  createAflTradeAdmittedPlayerFactualOutput,
  parseAflTradeAdmittedPlayerFactualOutput,
  type AflTradeAdmittedPlayerFactualOutput,
} from './privateValuationFactualOutput';

const preparationSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    admissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
  })
  .strict();

const parentSchema = z
  .object(aflTradeAdmittedPlayerFactualOutputContentSchema.shape)
  .omit({
    schemaVersion: true,
    environment: true,
    publicationEligible: true,
    publicationProhibited: true,
    limitation: true,
  })
  .strict();

export type AflTradeAdmittedPlayerFactualPreparationResult = Readonly<{
  state: 'prepared' | 'already_prepared';
  output: AflTradeAdmittedPlayerFactualOutput;
}>;

/** Retain existing admitted dataset custody for a dispatch, without inventing a single factual run. */
export class PostgresAflTradeAdmittedPlayerFactualPreparation {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async prepare(
    input: z.input<typeof preparationSchema>
  ): Promise<AflTradeAdmittedPlayerFactualPreparationResult> {
    const request = preparationSchema.parse(input);
    const leaseDigest = createHash('sha256').update(request.claim.leaseToken, 'utf8').digest('hex');
    const claimParameters = [request.requestId, request.claim.claimId, leaseDigest];
    return this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await transaction.query(
        'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
        claimParameters
      );
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `outcome-private-valuation-factual-output:${request.requestId}`,
      ]);
      const retained = await transaction.query<{ output_json: unknown }>(
        'SELECT output_json FROM outcome_private_valuation_factual_output WHERE request_id=$1',
        [request.requestId]
      );
      if (retained.rows.length > 1) {
        throw new TypeError('Dispatch has more than one retained factual output.');
      }
      const replay = retained.rows[0];
      const replayOutput = replay
        ? parseAflTradeAdmittedPlayerFactualOutput(replay.output_json)
        : null;
      if (replayOutput) {
        if (
          replayOutput.content.requestId !== request.requestId ||
          replayOutput.content.admittedPlayerDataset.datasetId !== request.datasetId ||
          replayOutput.content.admittedPlayerDataset.admissionId !== request.admissionId
        ) {
          throw new TypeError(
            'Retained admitted-player factual output binds another dataset or admission.'
          );
        }
      }
      const parent = await transaction.query<{ parent_json: unknown }>(
        'SELECT load_outcome_admitted_player_factual_parent($1,$2,$3,$4,$5) AS parent_json',
        [...claimParameters, request.datasetId, request.admissionId]
      );
      if (parent.rows.length !== 1) {
        throw new TypeError('Exact admitted-player factual parent is unavailable.');
      }
      const parsed = parentSchema.parse(parent.rows[0]!.parent_json);
      if (
        parsed.requestId !== request.requestId ||
        parsed.admittedPlayerDataset.datasetId !== request.datasetId ||
        parsed.admittedPlayerDataset.admissionId !== request.admissionId
      ) {
        throw new TypeError('Exact admitted-player factual parent does not match the request.');
      }
      const materialized = createAflTradeAdmittedPlayerFactualOutput({
        ...parsed,
        preparedAt: replayOutput?.content.preparedAt ?? parsed.preparedAt,
      });
      if (
        replayOutput &&
        canonicalizeAflTradeJson(materialized) !== canonicalizeAflTradeJson(replayOutput)
      ) {
        throw new TypeError(
          'Retained admitted-player factual output conflicts with its current parent custody.'
        );
      }
      const output = replayOutput ?? materialized;
      const persisted = await transaction.query<{ output_json: unknown }>(
        'SELECT retain_outcome_private_valuation_factual_output($1,$2,$3,$4::jsonb) AS output_json',
        [...claimParameters, canonicalizeAflTradeJson(output)]
      );
      if (persisted.rows.length !== 1) {
        throw new TypeError(
          'Admitted-player factual preparation did not retain exactly one output.'
        );
      }
      const exact = parseAflTradeAdmittedPlayerFactualOutput(persisted.rows[0]!.output_json);
      if (canonicalizeAflTradeJson(exact) !== canonicalizeAflTradeJson(output)) {
        throw new TypeError(
          'Retained admitted-player factual output conflicts with its parent custody.'
        );
      }
      return { state: replay ? 'already_prepared' : 'prepared', output: exact };
    });
  }
}
