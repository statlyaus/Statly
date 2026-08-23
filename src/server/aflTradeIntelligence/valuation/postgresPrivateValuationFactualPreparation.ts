import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { materializeAflTradePrivateValuationFactualOutput } from './internal/privateValuationFactualOutputMaterializer';
import {
  parseAflTradePrivateValuationFactualOutput,
  type AflTradePrivateValuationFactualOutput,
} from './privateValuationFactualOutput';
import { PostgresAflTradePrivateValuationSourceAdmission } from './postgresPrivateValuationSourceAdmission';
import type { AflTradePrivateValuationSourceAdmission } from './privateValuationSourceAdmission';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const requestIdSchema = z.string().regex(/^private-valuation-dispatch:[a-f0-9]{64}$/);
const claimIdSchema = z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/);
const leaseTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const candidateIdSchema = z.string().regex(/^factual-release-candidate:[a-f0-9]{64}$/);

export type AflTradePrivateValuationFactualPreparationResult =
  | { readonly state: 'prepared'; readonly output: AflTradePrivateValuationFactualOutput }
  | { readonly state: 'already_prepared'; readonly output: AflTradePrivateValuationFactualOutput };

export interface AflTradePrivateValuationFactualPreparationDependencies {
  readonly prepareSourceEvidence: (input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }) => Promise<void>;
  readonly prepareCandidate: (input: {
    readonly requestId: string;
    readonly admission: AflTradePrivateValuationSourceAdmission;
  }) => Promise<{ readonly candidateId: string }>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireExactOutput(
  expected: AflTradePrivateValuationFactualOutput,
  actual: AflTradePrivateValuationFactualOutput
): AflTradePrivateValuationFactualOutput {
  if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(actual)) {
    throw new TypeError('Retained factual output conflicts with its materialized parent chain.');
  }
  return actual;
}

export class PostgresAflTradePrivateFactualPreparation {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly dependencies: AflTradePrivateValuationFactualPreparationDependencies
  ) {}

  private async load(
    transaction: AflOutcomeSqlTransaction,
    requestId: string
  ): Promise<AflTradePrivateValuationFactualOutput | null> {
    const retained = await transaction.query<{ output_json: unknown }>(
      `SELECT output_json FROM outcome_private_valuation_factual_output WHERE request_id=$1`,
      [requestId]
    );
    if (retained.rows.length === 0) return null;
    if (retained.rows.length !== 1) {
      throw new TypeError('Dispatch has more than one retained factual output.');
    }
    return parseAflTradePrivateValuationFactualOutput(retained.rows[0].output_json);
  }

  private async retain(
    transaction: AflOutcomeSqlTransaction,
    input: {
      readonly requestId: string;
      readonly claimId: string;
      readonly leaseToken: string;
      readonly output: AflTradePrivateValuationFactualOutput;
    }
  ): Promise<AflTradePrivateValuationFactualOutput> {
    const retained = await transaction.query<{ output_json: unknown }>(
      `SELECT retain_outcome_private_valuation_factual_output($1,$2,$3,$4::jsonb)
              AS output_json`,
      [
        input.requestId,
        input.claimId,
        sha256(input.leaseToken),
        canonicalizeAflTradeJson(input.output),
      ]
    );
    if (retained.rows.length !== 1) {
      throw new TypeError('Factual preparation did not retain exactly one result.');
    }
    return requireExactOutput(
      input.output,
      parseAflTradePrivateValuationFactualOutput(retained.rows[0].output_json)
    );
  }

  async prepare(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationFactualPreparationResult> {
    const requestId = requestIdSchema.parse(input.requestId);
    const claimId = claimIdSchema.parse(input.claim.claimId);
    const leaseToken = leaseTokenSchema.parse(input.claim.leaseToken);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-private-valuation-factual-preparation:${requestId}`,
      ]);
      const replay = await this.load(transaction, requestId);
      if (replay) {
        return {
          state: 'already_prepared' as const,
          output: await this.retain(transaction, {
            requestId,
            claimId,
            leaseToken,
            output: replay,
          }),
        };
      }

      const claim = { claimId, leaseToken };
      await this.dependencies.prepareSourceEvidence({ requestId, claim });
      const admission = await new PostgresAflTradePrivateValuationSourceAdmission(
        this.client
      ).admit({ requestId, claim });
      const candidate = await this.dependencies.prepareCandidate({
        requestId,
        admission: admission.admission,
      });
      const candidateId = candidateIdSchema.parse(candidate.candidateId);
      const materialized = await materializeAflTradePrivateValuationFactualOutput(this.client, {
        requestId,
        candidateId,
      });
      return {
        state: 'prepared' as const,
        output: await this.retain(transaction, {
          requestId,
          claimId,
          leaseToken,
          output: materialized,
        }),
      };
    });
  }
}
