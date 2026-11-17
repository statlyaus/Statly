import { z } from 'zod';

import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  PostgresAflTradePreparedValuationInputSetStore,
  type AflTradePreparedValuationInputSetStore,
} from './postgresPreparedValuationInputSetStore';
import {
  PostgresAflTradeValuationSourceQualificationReportStore,
  type AflTradeValuationSourceQualificationReportStore,
} from './postgresValuationSourceQualificationReportStore';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
  createAflTradePreparedValuationInputSet,
  type AflTradePreparedValuationInputSet,
} from './preparedValuationInputSet';
import { assessAflTradeValuationSourcePolicyPreflight } from './valuationSourceAdmission';
import {
  AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
  createAflTradeValuationSourceQualificationReport,
  type AflTradeValuationSourceQualificationReport,
} from './valuationSourceQualificationReport';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const timestampSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const canonicalMemberSchema = z
  .object({
    recordKind: z.string().trim().min(1),
    canonicalRecordId: publicIdSchema,
    ordinal: z.number().int().positive(),
  })
  .passthrough();
const sourceCaptureSchema = z
  .object({ rightsArtifactId: publicIdSchema })
  .passthrough();
const releaseManifestSchema = z
  .object({
    releaseId: publicIdSchema,
    content: z
      .object({
        canonicalMembers: z.array(canonicalMemberSchema).min(1).max(1_000_000),
        sourceCaptures: z.array(sourceCaptureSchema).min(1).max(1_000),
      })
      .passthrough(),
  })
  .passthrough();

interface ReleaseRow {
  release_id: string;
  scope_key: string;
  environment: string;
  created_at: Date | string;
  prepared_at: Date | string;
  manifest_json: unknown;
}

interface SourceRightsRow {
  rights_artifact_id: string;
  proposed_at: Date | string;
  content_json: unknown;
}

export type AflTradeValuationSourceQualificationResult =
  | {
      readonly state: 'blocked';
      readonly qualificationReport: AflTradeValuationSourceQualificationReport;
      readonly preparedInputSet: AflTradePreparedValuationInputSet;
    }
  | {
      readonly state: 'requires_authenticated_dataset_admission';
      readonly qualificationReport: AflTradeValuationSourceQualificationReport;
    };

function isoTimestamp(value: Date | string): string {
  const parsed = timestampSchema.parse(value);
  return new Date(parsed).toISOString();
}

function exactUniqueSorted(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort();
  if (sorted.length === 0 || new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be a non-empty unique set.`);
  }
  return sorted;
}

export class PostgresAflTradeValuationSourceQualification {
  private readonly preparedSetStore: AflTradePreparedValuationInputSetStore;
  private readonly reportStore: AflTradeValuationSourceQualificationReportStore;

  constructor(
    private readonly client: AflOutcomeSqlClient,
    preparedSetStore?: AflTradePreparedValuationInputSetStore,
    reportStore?: AflTradeValuationSourceQualificationReportStore
  ) {
    this.preparedSetStore =
      preparedSetStore ?? new PostgresAflTradePreparedValuationInputSetStore(client);
    this.reportStore =
      reportStore ?? new PostgresAflTradeValuationSourceQualificationReportStore(client);
  }

  async prepare(input: {
    readonly factualReleaseId: string;
    readonly valuationScopeKey: string;
  }): Promise<AflTradeValuationSourceQualificationResult> {
    const factualReleaseId = publicIdSchema.parse(input.factualReleaseId);
    const valuationScopeKey = publicIdSchema.parse(input.valuationScopeKey);
    const planned = await this.client.transaction(async (transaction) => {
      const releaseResult = await transaction.query<ReleaseRow>(
        `SELECT release_id,scope_key,environment,created_at,manifest_json,
                transaction_timestamp() AS prepared_at
           FROM outcome_release_manifest
          WHERE release_id=$1 FOR KEY SHARE`,
        [factualReleaseId]
      );
      const releaseRow = releaseResult.rows[0];
      if (!releaseRow) throw new TypeError('The exact factual release does not exist.');
      if (releaseRow.environment !== 'non_production') {
        throw new TypeError('Local valuation source qualification is non-production only.');
      }
      const manifest = releaseManifestSchema.parse(releaseRow.manifest_json);
      if (manifest.releaseId !== releaseRow.release_id) {
        throw new TypeError('The factual release row and manifest identities disagree.');
      }

      const releaseTradeIds = exactUniqueSorted(
        manifest.content.canonicalMembers
          .filter(({ recordKind }) => recordKind === 'transaction')
          .map(({ canonicalRecordId }) => canonicalRecordId),
        'Factual-release transaction membership'
      );
      const rightsArtifactIds = exactUniqueSorted(
        manifest.content.sourceCaptures.map(({ rightsArtifactId }) => rightsArtifactId),
        'Factual-release source-rights ancestry'
      );
      const rightsResult = await transaction.query<SourceRightsRow>(
        `SELECT rights_artifact_id,proposed_at,content_json
           FROM outcome_source_rights_proposal
          WHERE rights_artifact_id=ANY($1::text[])
          ORDER BY rights_artifact_id FOR KEY SHARE`,
        [rightsArtifactIds]
      );
      if (
        rightsResult.rows.length !== rightsArtifactIds.length ||
        rightsResult.rows.some(
          ({ rights_artifact_id }, index) => rights_artifact_id !== rightsArtifactIds[index]
        )
      ) {
        throw new TypeError('The factual release source-rights ancestry is incomplete.');
      }
      const rights = rightsResult.rows.map((row) => {
        const proposal = aflTradeSourceRightsProposalSchema.parse(row.content_json);
        if (
          proposal.rightsArtifactId !== row.rights_artifact_id ||
          proposal.content.proposedAt !== isoTimestamp(row.proposed_at)
        ) {
          throw new TypeError('A source-rights row disagrees with its immutable proposal.');
        }
        return proposal;
      });
      const preparedAt = isoTimestamp(releaseRow.prepared_at);
      const preflight = assessAflTradeValuationSourcePolicyPreflight({
        rights,
        evaluatedAt: preparedAt,
      });
      const sourceQualificationEvidenceRefs = rights
        .map((proposal) =>
          createAflTradeCanonicalJsonArtifactRef(proposal, proposal.content.proposedAt)
        )
        .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
      const factualReleaseArtifact = createAflTradeCanonicalJsonArtifactRef(
        manifest,
        isoTimestamp(releaseRow.created_at)
      );
      const releaseMembershipArtifact = createAflTradeCanonicalJsonArtifactRef(
        manifest.content.canonicalMembers,
        isoTimestamp(releaseRow.created_at)
      );
      const blockers =
        preflight.state === 'blocked'
          ? [...preflight.blockers].sort((left, right) =>
              `${left.code}\0${left.subject.kind}\0${left.subject.id}`.localeCompare(
                `${right.code}\0${right.subject.kind}\0${right.subject.id}`
              )
            )
          : null;
      const qualificationDecision =
        blockers === null
          ? { state: 'eligible_for_dataset_admission' as const }
          : { state: 'blocked' as const, blockers };
      const qualificationReport = createAflTradeValuationSourceQualificationReport({
        schemaVersion: AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
        environment: 'non_production',
        operation: 'valuation_model_training_and_derived_feature_creation',
        valuationScopeKey,
        factualReleaseScopeKey: publicIdSchema.parse(releaseRow.scope_key),
        factualReleaseId,
        factualReleaseArtifact,
        releaseMembershipArtifact,
        releaseTradeIds,
        sourceRightsEvidenceRefs: sourceQualificationEvidenceRefs,
        decision: qualificationDecision,
        evaluatedAt: preparedAt,
        publicationEligible: false,
        limitation:
          'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.',
      });
      if (preflight.state === 'requires_authenticated_dataset_admission') {
        return {
          state: preflight.state,
          qualificationReport,
        } as const;
      }

      if (blockers === null) {
        throw new TypeError('Blocked source qualification did not retain its exact blockers.');
      }
      const entries = releaseTradeIds.map((tradeId) => ({
        tradeId,
        state: 'blocked' as const,
        blockers,
      }));
      return {
        state: 'blocked',
        qualificationReport,
        preparedInputSet: createAflTradePreparedValuationInputSet({
          schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
          environment: 'non_production',
          scopeKey: valuationScopeKey,
          factualReleaseScopeKey: publicIdSchema.parse(releaseRow.scope_key),
          factualReleaseId,
          factualReleaseArtifact,
          releaseMembershipArtifact,
          preparationAuthority: 'source_policy_preflight_only',
          qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
          qualificationReportId: qualificationReport.qualificationReportId,
          qualificationReportArtifact: createAflTradeCanonicalJsonArtifactRef(
            qualificationReport,
            preparedAt
          ),
          sourceQualificationEvidenceRefs,
          releaseTradeIds,
          entries,
          tradeCount: entries.length,
          readyCount: 0,
          blockedCount: entries.length,
          preparedAt,
          publicationEligible: false,
          limitation:
            'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
        }),
      } as const;
    });

    const qualificationReport = await this.reportStore.register(planned.qualificationReport);
    if (planned.state !== 'blocked') {
      return { state: planned.state, qualificationReport };
    }
    return {
      state: 'blocked',
      qualificationReport,
      preparedInputSet: await this.preparedSetStore.register(planned.preparedInputSet),
    };
  }
}
