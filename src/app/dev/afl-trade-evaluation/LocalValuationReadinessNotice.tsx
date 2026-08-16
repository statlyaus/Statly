import type { LocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';

function requiredAuthorityLabel(
  authority: LocalAflTradeValuationReadiness['requiredNextAuthority']
): string {
  if (authority === 'source_qualification') return 'Exact-release source qualification';
  if (authority === 'model_training_and_derived_feature_creation') {
    return 'Model training and derived-feature creation';
  }
  if (authority === 'authenticated_player_and_pick_model_runs') {
    return 'Authenticated player and pick model runs';
  }
  if (authority === 'private_nonproduction_derived_calculation_authority') {
    return 'Private non-production calculation authority';
  }
  return 'Authenticated private calculation inputs';
}

export function LocalValuationReadinessNotice({
  readiness,
  historicalCalculationAvailable = false,
}: {
  readonly readiness: LocalAflTradeValuationReadiness;
  readonly historicalCalculationAvailable?: boolean;
}) {
  return (
    <section
      aria-labelledby="local-valuation-readiness-heading"
      className="rounded-2xl border border-warning/35 bg-warning/10 p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Governed numerical lane
          </p>
          <h2
            id="local-valuation-readiness-heading"
            className="mt-2 text-xl font-semibold text-foreground"
          >
            {historicalCalculationAvailable
              ? 'Complete trade grading remains blocked'
              : 'Numerical valuation preparation is blocked'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {historicalCalculationAvailable
              ? 'Reviewed historical player PAV is available below. Pick values, predictive remaining value, complete package comparison, and letter-grade distributions still require the listed authority.'
              : readiness.explanation}
          </p>
        </div>
        <span className="rounded-full border border-warning/35 bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
          Blocked · {readiness.blockerCodes.join(', ')}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Calculation evidence
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {readiness.privateEvaluationEvidenceKind === 'retained_private_review'
              ? `${readiness.retainedEvidenceCandidateCount?.toLocaleString() ?? 'Unknown'} reviewed candidates · ${readiness.retainedEvidenceSourceCaptureCount ?? 'Unknown'} captures`
              : readiness.qualificationReportCreated
                ? `${readiness.scopeKey} · retained for ${readiness.factualReleaseId}`
                : `${readiness.scopeKey} · no governed evidence`}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-background p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Private calculation authority
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {readiness.privateEvaluationAuthorityState === 'authorized'
              ? `Authorized · ${readiness.privateEvaluationDecisionId}`
              : readiness.privateEvaluationAuthorityState === 'withdrawn'
                ? `Withdrawn · ${readiness.privateEvaluationDecisionId}`
                : readiness.privateEvaluationAuthorityState === 'evidence_invalid'
                  ? `Blocked · retained evidence is no longer current`
                  : 'Not authorized'}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-background p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required next authority
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {requiredAuthorityLabel(readiness.requiredNextAuthority)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        This status reads the current authenticated private-evaluation decision and its exact
        evidence from the admitted disposable PostgreSQL runtime. Retained-review evidence is not a
        factual release. Private authority does not amend source rights and grants no training,
        public display, redistribution, production, capture, or publication permission.
      </p>
    </section>
  );
}
