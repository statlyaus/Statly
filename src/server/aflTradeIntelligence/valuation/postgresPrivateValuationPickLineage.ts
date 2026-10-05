import { z } from 'zod';

import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import type { PrivateEvaluationAuthorityEvidence } from './postgresPrivateEvaluationInspectionStore';
import {
  materializePrivateValuationPickLineage,
  type PrivateValuationPickLineageFacts,
  type PrivateValuationPickLineageMaterializationResult,
} from './privateValuationPickLineageMaterialization';

const instantSchema = z.iso.datetime({ offset: true });
const idSchema = z.string().trim().min(1).max(500);
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const transferSchema = z
  .object({
    assetVersionId: idSchema,
    eventVersionId: idSchema,
    eventDate: instantSchema,
    recordedAt: instantSchema,
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    playerId: idSchema.nullable(),
    pickId: idSchema.nullable(),
    draftYear: z.number().int().min(1897).max(2200).nullable(),
    fromClubId: idSchema,
    toClubId: idSchema,
    evidenceId: idSchema,
  })
  .strict();
const transformationSchema = z
  .object({
    edgeId: idSchema,
    parentPickId: idSchema,
    childPickId: idSchema,
    relationKind: z.enum([
      'future_right_resolved_to_pick',
      'pick_renumbered_to_pick',
    ]),
    effectiveAt: instantSchema,
    knownFrom: instantSchema,
    evidenceId: idSchema,
  })
  .strict();
const custodySchema = z
  .object({
    custodyObservationId: idSchema,
    pickId: idSchema,
    observedAt: instantSchema,
    currentClubId: idSchema,
    recordedAt: instantSchema,
    evidenceId: idSchema,
  })
  .strict();
const realizationSchema = z
  .object({
    realizationId: idSchema,
    transferAssetVersionId: idSchema,
    pickId: idSchema,
    draftSelectionId: idSchema,
    recordedAt: instantSchema,
    evidenceId: idSchema,
  })
  .strict();
const selectionSchema = z
  .object({
    selectionId: idSchema,
    pickId: idSchema,
    playerId: idSchema,
    clubId: idSchema,
    eventDate: instantSchema,
    recordedAt: instantSchema,
    evidenceId: idSchema,
  })
  .strict();
const spellSchema = z
  .object({
    spellVersionId: idSchema,
    startAssetVersionId: idSchema,
    playerId: idSchema,
    clubId: idSchema,
    startDate: instantSchema,
    endDate: instantSchema.nullable(),
    recordedAt: instantSchema,
    evidenceId: idSchema,
  })
  .strict();

const factBundleSchema = z
  .object({
    transfers: z.array(transferSchema).max(100_000),
    pickTransformations: z.array(transformationSchema).max(100_000),
    custodyObservations: z.array(custodySchema).max(100_000),
    realizations: z.array(realizationSchema).max(100_000),
    selections: z.array(selectionSchema).max(100_000),
    acquisitionSpells: z.array(spellSchema).max(100_000),
  })
  .strict();

const membershipSchema = z
  .object({
    schemaVersion: z.literal('private-pick-lineage-postgres-readback/v1'),
    releaseId: idSchema,
    rootAssetVersionId: idSchema,
    members: z
      .array(
        z
          .object({
            kind: z.enum([
              'event_asset',
              'event_version',
              'pick_lineage',
              'pick_custody',
              'pick_realization',
              'draft_selection',
              'acquisition_spell',
            ]),
            id: idSchema,
            recordSha256: shaSchema,
          })
          .strict()
      )
      .min(1)
      .max(500_000),
  })
  .strict()
  .superRefine((membership, context) => {
    const keys = membership.members.map(({ kind, id }) => `${kind}|${id}`);
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => index > 0 && keys[index - 1]! > key)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Pick-lineage release members must be unique and canonically ordered.',
      });
    }
  });

export type PostgresPrivateValuationPickLineageMembership = z.infer<
  typeof membershipSchema
>;

interface ReadbackRow {
  facts_json: unknown;
  membership_json: unknown;
}

export type PostgresPrivateValuationPickLineageResult =
  | {
      state: 'ready';
      materialization: Extract<
        PrivateValuationPickLineageMaterializationResult,
        { state: 'ready' }
      >;
      facts: Omit<PrivateValuationPickLineageFacts, 'root' | 'knowledgeCutoffAt'>;
      membership: PostgresPrivateValuationPickLineageMembership;
      evidence: PrivateEvaluationAuthorityEvidence;
    }
  | {
      state: 'unavailable';
      assetId: string;
      reasons: string[];
      evidence: PrivateEvaluationAuthorityEvidence[];
    };

function iso(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private pick lineage requires exact retained chronology.');
  }
  return parsed.toISOString();
}

export async function loadPostgresPrivateValuationPickLineage(
  transaction: AflOutcomeSqlTransaction,
  input: {
    factualReleaseId: string;
    assetId: string;
    assetVersionId: string;
    assetKind: 'pick' | 'future_pick';
    receivingClubId: string;
    tradeEffectiveAt: string;
    knowledgeCutoffAt: string;
    admittedAt: string;
  }
): Promise<PostgresPrivateValuationPickLineageResult> {
  const admittedAt = iso(input.admittedAt);
  const knowledgeCutoffAt = iso(input.knowledgeCutoffAt);
  const tradeEffectiveAt = iso(input.tradeEffectiveAt);
  if (
    Date.parse(tradeEffectiveAt) > Date.parse(knowledgeCutoffAt) ||
    Date.parse(knowledgeCutoffAt) > Date.parse(admittedAt)
  ) {
    throw new TypeError('Private pick lineage chronology exceeds the inspection cutoff.');
  }
  const result = await transaction.query<ReadbackRow>(
    `/* private-pick-lineage-exact-release-readback */
     WITH transfer_fact AS (
       SELECT jsonb_build_object(
                'assetVersionId',asset.asset_version_id,
                'eventVersionId',asset.event_version_id,
                'eventDate',to_char(version.event_date,'YYYY-MM-DD')||'T00:00:00.000Z',
                'recordedAt',to_char(version.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'assetKind',CASE asset.kind::text
                  WHEN 'current_pick' THEN 'pick' ELSE asset.kind::text END,
                'playerId',asset.player_id,'pickId',asset.pick_id,
                'draftYear',pick.draft_season_year,
                'fromClubId',asset.from_club_id,'toClubId',asset.to_club_id,
                'evidenceId','release-member:'||asset_member.record_sha256
              ) AS fact
         FROM outcome_release_event_asset asset_member
         JOIN outcome_event_asset asset ON asset.asset_version_id=asset_member.asset_version_id
    LEFT JOIN outcome_draft_pick pick ON pick.pick_id=asset.pick_id
         JOIN outcome_release_event_version version_member
           ON version_member.release_id=asset_member.release_id
          AND version_member.event_version_id=asset.event_version_id
         JOIN outcome_event_version version ON version.event_version_id=asset.event_version_id
        WHERE asset_member.release_id=$1
          AND asset.kind IN ('player','current_pick','future_pick')
          AND asset.from_club_id IS NOT NULL AND asset.to_club_id IS NOT NULL
          AND version.kind='trade'
          AND version.recorded_at<=$3::timestamptz
     ), transformation_fact AS (
       SELECT jsonb_build_object(
                'edgeId',edge.edge_id,'parentPickId',edge.parent_pick_id,
                'childPickId',edge.child_pick_id,
                'relationKind',CASE
                  WHEN parent.nominal_pick IS NULL THEN 'future_right_resolved_to_pick'
                  ELSE 'pick_renumbered_to_pick' END,
                'effectiveAt',to_char(edge.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'knownFrom',to_char(edge.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'evidenceId','release-member:'||member.record_sha256
              ) AS fact
         FROM outcome_release_pick_lineage member
         JOIN outcome_pick_lineage_edge edge ON edge.edge_id=member.edge_id
         JOIN outcome_draft_pick parent ON parent.pick_id=edge.parent_pick_id
        WHERE member.release_id=$1 AND edge.recorded_at<=$3::timestamptz
     ), custody_fact AS (
       SELECT jsonb_build_object(
                'custodyObservationId',custody.custody_observation_id,
                'pickId',custody.pick_id,
                'observedAt',to_char(custody.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'currentClubId',custody.current_club_id,
                'recordedAt',to_char(custody.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'evidenceId','release-member:'||member.record_sha256
              ) AS fact
         FROM outcome_release_pick_custody member
         JOIN outcome_pick_custody_observation custody
           ON custody.custody_observation_id=member.custody_observation_id
        WHERE member.release_id=$1 AND custody.recorded_at<=$3::timestamptz
     ), realization_fact AS (
       SELECT jsonb_build_object(
                'realizationId',realization.realization_id,
                'transferAssetVersionId',realization.transfer_asset_version_id,
                'pickId',realization.pick_id,'draftSelectionId',realization.draft_selection_id,
                'recordedAt',to_char(realization.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'evidenceId','release-member:'||member.record_sha256
              ) AS fact
         FROM outcome_release_pick_realization member
         JOIN outcome_pick_realization realization ON realization.realization_id=member.realization_id
        WHERE member.release_id=$1 AND realization.recorded_at<=$3::timestamptz
     ), selection_fact AS (
       SELECT jsonb_build_object(
                'selectionId',selection.selection_id,'pickId',selection.pick_id,
                'playerId',selection.player_id,'clubId',selection.club_id,
                'eventDate',to_char(version.event_date,'YYYY-MM-DD')||'T00:00:00.000Z',
                'recordedAt',to_char(version.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'evidenceId','release-member:'||member.record_sha256
              ) AS fact
         FROM outcome_release_draft_selection member
         JOIN outcome_draft_selection selection ON selection.selection_id=member.selection_id
         JOIN outcome_release_event_version version_member
           ON version_member.release_id=member.release_id
          AND version_member.event_version_id=selection.event_version_id
         JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
        WHERE member.release_id=$1 AND selection.pick_id IS NOT NULL
          AND selection.player_id IS NOT NULL AND version.recorded_at<=$3::timestamptz
     ), spell_fact AS (
       SELECT jsonb_build_object(
                'spellVersionId',spell.spell_version_id,
                'startAssetVersionId',spell.start_asset_version_id,
                'playerId',spell.player_id,'clubId',spell.club_id,
                'startDate',to_char(spell.start_date,'YYYY-MM-DD')||'T00:00:00.000Z',
                'endDate',CASE WHEN spell.end_date IS NULL THEN NULL
                  ELSE to_char(spell.end_date,'YYYY-MM-DD')||'T00:00:00.000Z' END,
                'recordedAt',to_char(spell.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'evidenceId','release-member:'||member.record_sha256
              ) AS fact
         FROM outcome_release_acquisition_spell member
         JOIN outcome_acquisition_spell_version spell
           ON spell.spell_version_id=member.spell_version_id
        WHERE member.release_id=$1 AND spell.recorded_at<=$3::timestamptz
     ), member_fact AS (
       SELECT 'event_asset' AS kind,asset_version_id AS id,record_sha256
         FROM outcome_release_event_asset WHERE release_id=$1
       UNION ALL SELECT 'event_version',event_version_id,record_sha256
         FROM outcome_release_event_version WHERE release_id=$1
       UNION ALL SELECT 'pick_lineage',edge_id,record_sha256
         FROM outcome_release_pick_lineage WHERE release_id=$1
       UNION ALL SELECT 'pick_custody',custody_observation_id,record_sha256
         FROM outcome_release_pick_custody WHERE release_id=$1
       UNION ALL SELECT 'pick_realization',realization_id,record_sha256
         FROM outcome_release_pick_realization WHERE release_id=$1
       UNION ALL SELECT 'draft_selection',selection_id,record_sha256
         FROM outcome_release_draft_selection WHERE release_id=$1
       UNION ALL SELECT 'acquisition_spell',spell_version_id,record_sha256
         FROM outcome_release_acquisition_spell WHERE release_id=$1
     )
     SELECT jsonb_build_object(
              'transfers',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'assetVersionId') FROM transfer_fact),'[]'::jsonb),
              'pickTransformations',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'edgeId') FROM transformation_fact),'[]'::jsonb),
              'custodyObservations',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'observedAt',fact->>'custodyObservationId') FROM custody_fact),'[]'::jsonb),
              'realizations',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'realizationId') FROM realization_fact),'[]'::jsonb),
              'selections',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'selectionId') FROM selection_fact),'[]'::jsonb),
              'acquisitionSpells',COALESCE((SELECT jsonb_agg(fact ORDER BY fact->>'spellVersionId') FROM spell_fact),'[]'::jsonb)
            ) AS facts_json,
            jsonb_build_object(
              'schemaVersion','private-pick-lineage-postgres-readback/v1',
              'releaseId',$1,'rootAssetVersionId',$2::text,
              'members',(SELECT jsonb_agg(jsonb_build_object(
                'kind',kind,'id',id,'recordSha256',record_sha256) ORDER BY kind,id)
                FROM member_fact)
            ) AS membership_json
       WHERE EXISTS (
         SELECT 1 FROM outcome_release_event_asset
          WHERE release_id=$1 AND asset_version_id=$2::text
       )`,
    [input.factualReleaseId, input.assetVersionId, knowledgeCutoffAt]
  );
  if (result.rows.length === 0) {
    return {
      state: 'unavailable',
      assetId: input.assetId,
      reasons: ['exact_release_pick_lineage_missing'],
      evidence: [],
    };
  }
  if (result.rows.length !== 1) {
    throw new TypeError('Private pick lineage readback is ambiguous.');
  }
  const facts = factBundleSchema.parse(result.rows[0]!.facts_json);
  const membership = membershipSchema.parse(result.rows[0]!.membership_json);
  if (
    membership.releaseId !== input.factualReleaseId ||
    membership.rootAssetVersionId !== input.assetVersionId
  ) {
    throw new TypeError('Private pick lineage release membership drifted.');
  }
  const evidence: PrivateEvaluationAuthorityEvidence = {
    role: 'pick_evidence',
    source: 'postgres_json',
    document: { membership, facts },
    createdAt: admittedAt,
  };
  const rootTransfer = facts.transfers.find(
    ({ assetVersionId }) => assetVersionId === input.assetVersionId
  );
  const materialization = materializePrivateValuationPickLineage({
    root: {
      assetId: input.assetId,
      transferAssetVersionId: input.assetVersionId,
      pickId: rootTransfer?.pickId ?? '',
      assetKind: input.assetKind,
      receivingClubId: input.receivingClubId,
      tradeEffectiveAt,
      evidenceId: rootTransfer?.evidenceId ?? 'release-member:missing',
    },
    knowledgeCutoffAt,
    ...(facts as Omit<PrivateValuationPickLineageFacts, 'root' | 'knowledgeCutoffAt'>),
  });
  if (materialization.state !== 'ready') {
    return {
      state: 'unavailable',
      assetId: input.assetId,
      reasons: materialization.reasons,
      evidence: [evidence],
    };
  }
  return { state: 'ready', materialization, facts, membership, evidence };
}
