import { createHash } from 'node:crypto';

import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  PostgresAflTradeAdmittedPlayerFactualPreparation,
  type AflTradeAdmittedPlayerFactualPreparationResult,
} from './postgresAdmittedPlayerFactualPreparation';
import type {
  PostgresAflTradePrivateFactualPreparation,
  AflTradePrivateValuationFactualPreparationResult,
} from './postgresPrivateValuationFactualPreparation';

const bindingSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    factualOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    privateFactualCandidateId: aflTradeContentAddressedIdSchema('private-factual-candidate'),
    privateFactualRevision: z.number().int().positive(),
    hpnFactualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    hpnInputSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    hpnFinalizedAt: z.string().datetime(),
  })
  .strict();

const bindingSelectionSchema = bindingSchema.pick({
  factualOperationId: true,
  hpnFactualRunId: true,
});
const sourceBindingSchema = bindingSchema
  .omit({ factualOperationId: true, privateFactualCandidateId: true, privateFactualRevision: true })
  .extend({
    authorityKind: z.literal('source_first'),
    sourceAdmissionId: aflTradeContentAddressedIdSchema('private-valuation-source-admission'),
  })
  .strict();
const anyBindingSchema = z.union([bindingSchema, sourceBindingSchema]);
const sourceSelectionSchema = sourceBindingSchema.pick({
  authorityKind: true,
  hpnFactualRunId: true,
});
const explicitSelectionSchema = z.union([bindingSelectionSchema, sourceSelectionSchema]);
const selectionSchema = bindingSelectionSchema
  .extend({
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    admissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
  })
  .strict();

/** Compose factual preparation and exact current HPN ancestry without granting parent authority. */
export class PostgresAflTradePrivateValuationHpnFactualPreparation {
  private readonly selection: z.infer<typeof explicitSelectionSchema>;
  private readonly factualPreparation: {
    prepare(
      input: Parameters<PostgresAflTradePrivateFactualPreparation['prepare']>[0]
    ): Promise<
      | AflTradePrivateValuationFactualPreparationResult
      | AflTradeAdmittedPlayerFactualPreparationResult
    >;
  };

  constructor(client: AflOutcomeSqlClient, selection: z.input<typeof selectionSchema>);
  constructor(
    client: AflOutcomeSqlClient,
    selection: z.input<typeof explicitSelectionSchema>,
    sourceFirstPreparation: Pick<PostgresAflTradePrivateFactualPreparation, 'prepare'>
  );
  constructor(
    private readonly client: AflOutcomeSqlClient,
    selection: z.input<typeof selectionSchema> | z.input<typeof explicitSelectionSchema>,
    sourceFirstPreparation?: Pick<PostgresAflTradePrivateFactualPreparation, 'prepare'>
  ) {
    if (sourceFirstPreparation === undefined) {
      const admitted = selectionSchema.parse(selection);
      this.selection = admitted;
      const preparation = new PostgresAflTradeAdmittedPlayerFactualPreparation(client);
      this.factualPreparation = {
        prepare: (input) =>
          preparation.prepare({
            ...input,
            datasetId: admitted.datasetId,
            admissionId: admitted.admissionId,
          }),
      };
    } else {
      // The strict selection rejects mixed source-first/admitted-dataset inputs.
      this.selection = explicitSelectionSchema.parse(selection);
      this.factualPreparation = sourceFirstPreparation;
    }
  }

  async prepare(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }) {
    const factual = await this.factualPreparation.prepare(input);
    const sourceFirst = 'authorityKind' in this.selection;
    if (
      sourceFirst &&
      factual.output.content.schemaVersion !== 'afl-trade-private-valuation-factual-output/v1'
    )
      throw new TypeError(
        'Source-first HPN binding requires the exact source-first factual output.'
      );
    await this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const result = await transaction.query<{ readonly binding_json: unknown }>(
        sourceFirst
          ? 'SELECT bind_outcome_private_valuation_source_hpn_factual_input($1,$2,$3,$4,$5) AS binding_json'
          : 'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6) AS binding_json',
        [
          input.requestId,
          input.claim.claimId,
          createHash('sha256').update(input.claim.leaseToken, 'utf8').digest('hex'),
          factual.output.outputId,
          ...('factualOperationId' in this.selection ? [this.selection.factualOperationId] : []),
          this.selection.hpnFactualRunId,
        ]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Exact HPN factual binding was not retained.');
      }
      const binding = anyBindingSchema.parse(result.rows[0]!.binding_json);
      if (
        binding.requestId !== input.requestId ||
        binding.factualOutputId !== factual.output.outputId ||
        ('authorityKind' in binding
          ? !sourceFirst ||
            factual.output.content.schemaVersion !==
              'afl-trade-private-valuation-factual-output/v1' ||
            binding.sourceAdmissionId !== factual.output.content.sourceAdmissionId
          : !('factualOperationId' in this.selection) ||
            binding.factualOperationId !== this.selection.factualOperationId) ||
        binding.hpnFactualRunId !== this.selection.hpnFactualRunId
      ) {
        throw new TypeError('Retained HPN factual binding differs from its selection.');
      }
    });
    return factual;
  }
}

/** Read through the claim/current-authority validator, never directly from the retained table. */
export async function loadAflTradePrivateValuationHpnFactualBinding(
  transaction: AflOutcomeSqlTransaction,
  input: { readonly requestId: string; readonly factualOutputId: string }
) {
  const binding = await findAflTradePrivateValuationHpnFactualBinding(transaction, input);
  if (binding === null)
    throw new TypeError('Current admitted-player HPN factual binding is unavailable.');
  return binding;
}

/** Absence is only for legacy unbound v1 preparation; stale retained bindings still throw. */
export async function findAflTradePrivateValuationHpnFactualBinding(
  transaction: AflOutcomeSqlTransaction,
  input: { readonly requestId: string; readonly factualOutputId: string }
) {
  const result = await transaction.query<{ readonly binding_json: unknown }>(
    'SELECT load_outcome_private_valuation_hpn_factual_input($1,$2) AS binding_json',
    [input.requestId, input.factualOutputId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Current admitted-player HPN factual binding is unavailable.');
  }
  if (result.rows[0]!.binding_json === null) return null;
  const binding = anyBindingSchema.parse(result.rows[0].binding_json);
  if (binding.requestId !== input.requestId || binding.factualOutputId !== input.factualOutputId) {
    throw new TypeError('Current admitted-player HPN factual binding belongs to another request.');
  }
  return binding;
}
