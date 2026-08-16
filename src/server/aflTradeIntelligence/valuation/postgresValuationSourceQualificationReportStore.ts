import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeValuationSourceQualificationReportSchema,
  type AflTradeValuationSourceQualificationReport,
} from './valuationSourceQualificationReport';

interface QualificationReportRow {
  qualification_report_id: string;
  report_json: unknown;
  finalized_at: Date | string | null;
}

export interface AflTradeValuationSourceQualificationReportStore {
  register(
    report: AflTradeValuationSourceQualificationReport
  ): Promise<AflTradeValuationSourceQualificationReport>;
}

export class PostgresAflTradeValuationSourceQualificationReportStore
  implements AflTradeValuationSourceQualificationReportStore
{
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async register(
    input: AflTradeValuationSourceQualificationReport
  ): Promise<AflTradeValuationSourceQualificationReport> {
    const report = aflTradeValuationSourceQualificationReportSchema.parse(input);
    const contentCanonicalJson = canonicalizeAflTradeJson(report.content);
    const reportCanonicalJson = canonicalizeAflTradeJson(report);
    const decisionState = report.content.decision.state;

    return this.client.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO outcome_valuation_source_qualification_report (
           qualification_report_id,content_sha256,schema_version,environment,operation,
           valuation_scope_key,factual_release_scope_key,factual_release_id,decision_state,
           evaluated_at,content_canonical_json,report_canonical_json,report_json,finalized_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$10)
         ON CONFLICT (qualification_report_id) DO NOTHING`,
        [
          report.qualificationReportId,
          sha256AflTradeCanonicalJson(report.content),
          report.content.schemaVersion,
          report.content.environment,
          report.content.operation,
          report.content.valuationScopeKey,
          report.content.factualReleaseScopeKey,
          report.content.factualReleaseId,
          decisionState,
          report.content.evaluatedAt,
          contentCanonicalJson,
          reportCanonicalJson,
          reportCanonicalJson,
        ]
      );
      const result = await transaction.query<QualificationReportRow>(
        `SELECT qualification_report_id,report_json,finalized_at
           FROM outcome_valuation_source_qualification_report
          WHERE qualification_report_id=$1 FOR KEY SHARE`,
        [report.qualificationReportId]
      );
      const row = result.rows[0];
      if (!row || row.finalized_at === null) {
        throw new TypeError('Source qualification report registration did not finalize.');
      }
      const retained = aflTradeValuationSourceQualificationReportSchema.parse(row.report_json);
      if (
        retained.qualificationReportId !== row.qualification_report_id ||
        canonicalizeAflTradeJson(retained) !== reportCanonicalJson
      ) {
        throw new TypeError('Source qualification report replay disagrees with retained evidence.');
      }
      return retained;
    });
  }
}
