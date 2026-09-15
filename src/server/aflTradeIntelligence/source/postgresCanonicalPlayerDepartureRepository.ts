import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type {
  AflTradeAcquisitionRegistrationEvidenceReader,
  AflTradeAcquisitionRegistrationExecution,
} from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import {
  canonicalPlayerDepartureSchema,
  type CanonicalPlayerDeparture,
} from './canonicalPlayerDeparture';

/** Current review and source checks also run in SQL, including direct writes and later reads. */
export class PostgresCanonicalPlayerDepartureRepository {
  constructor(
    private readonly database: AflOutcomeSqlClient,
    private readonly evidence: AflTradeAcquisitionRegistrationEvidenceReader
  ) {}
  async register(
    input: CanonicalPlayerDeparture,
    approvalDecisionId: string,
    execution: AflTradeAcquisitionRegistrationExecution
  ) {
    const record = canonicalPlayerDepartureSchema.parse(input);
    await this.authenticate(record, execution);
    return this.database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `outcome-review-subject:canonical_player_departure:${record.departureEventId}`,
      ]);
      await tx.query(
        `INSERT INTO outcome_canonical_player_departure
    (departure_event_id,content_canonical_json,approval_decision_id,registered_at,acquisition_asset_version_id)
    VALUES ($1,$2,$3,date_trunc('milliseconds',transaction_timestamp()),$4) ON CONFLICT (departure_event_id) DO NOTHING`,
        [
          record.departureEventId,
          canonicalizeAflTradeJson(record.content),
          approvalDecisionId,
          record.content.acquisition.assetVersionId,
        ]
      );
      const rows = await tx.query(
        `SELECT departure_event_id FROM outcome_canonical_player_departure
    WHERE departure_event_id=$1 AND content_canonical_json=$2 AND approval_decision_id=$3
    AND outcome_canonical_player_departure_current(departure_event_id,transaction_timestamp()) FOR SHARE`,
        [record.departureEventId, canonicalizeAflTradeJson(record.content), approvalDecisionId]
      );
      if (rows.rows.length !== 1)
        throw new Error('Canonical departure authority is not current and exact.');
      return record;
    });
  }
  async loadCurrentExact(id: string, execution: AflTradeAcquisitionRegistrationExecution) {
    return this.database.transaction(async (tx) => {
      const result = await tx.query<{ content_canonical_json: string }>(
        `SELECT content_canonical_json FROM outcome_canonical_player_departure
    WHERE departure_event_id=$1 AND outcome_canonical_player_departure_current(departure_event_id,transaction_timestamp()) FOR SHARE`,
        [id]
      );
      if (result.rows.length !== 1)
        throw new Error('Canonical departure authority is not current and exact.');
      const record = canonicalPlayerDepartureSchema.parse({
        departureEventId: id,
        content: JSON.parse(result.rows[0]!.content_canonical_json),
      });
      await this.authenticate(record, execution);
      return record;
    });
  }
  private async authenticate(
    record: CanonicalPlayerDeparture,
    execution: AflTradeAcquisitionRegistrationExecution
  ) {
    if (
      record.content.environment !== execution.environment ||
      record.content.competition !== execution.competition
    )
      throw new Error('Canonical departure execution scope differs.');
    for (const ref of [...record.content.evidence, ...record.content.acquisition.evidence]) {
      if (!doesAflTradeArtifactRefMatchBytes(ref, await this.evidence.read(ref)))
        throw new Error('Canonical departure evidence bytes differ.');
    }
  }
}
