import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeHpnPavMethodSchema } from './hpnPlayerApproximateValue';

export const AFL_TRADE_HPN_CALCULATION_ELIGIBILITY_SCHEMA_VERSION =
  'afl-trade-hpn-calculation-eligibility/v3' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).min(1).max(100);

export const aflTradeHpnCalculationMethodSelectionSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('authenticated'),
      methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
      methodArtifact: aflTradeArtifactRefSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('missing'),
      methodId: z.null(),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
]);

export type AflTradeHpnCalculationMethodSelection = z.infer<
  typeof aflTradeHpnCalculationMethodSelectionSchema
>;

const semanticFieldSchema = z.enum([
  'awayClub',
  'awayPoints',
  'clearances',
  'club',
  'completionStatus',
  'freeKicksAgainst',
  'freeKicksFor',
  'goalAssists',
  'hitOuts',
  'homeClub',
  'homePoints',
  'inside50s',
  'marks',
  'marksInside50',
  'match',
  'onePercenters',
  'player',
  'rebound50s',
  'tackles',
  'totalPoints',
]);

export type AflTradeHpnRequiredSemanticField = z.infer<typeof semanticFieldSchema>;

const resultFields = [
  'awayClub',
  'awayPoints',
  'completionStatus',
  'homeClub',
  'homePoints',
  'match',
] as const satisfies readonly AflTradeHpnRequiredSemanticField[];

const playerFields = [
  'clearances',
  'club',
  'freeKicksAgainst',
  'freeKicksFor',
  'goalAssists',
  'hitOuts',
  'inside50s',
  'marks',
  'marksInside50',
  'match',
  'onePercenters',
  'player',
  'rebound50s',
  'tackles',
  'totalPoints',
] as const satisfies readonly AflTradeHpnRequiredSemanticField[];

export function listAflTradeHpnRequiredSemanticFields(
  inputKind: 'completed_match_result' | 'player_match_stats'
): readonly AflTradeHpnRequiredSemanticField[] {
  return inputKind === 'completed_match_result' ? resultFields : playerFields;
}

const rawAvailabilitySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), evidenceRefs: evidenceRefsSchema }).strict(),
  z.object({ state: z.literal('missing'), evidenceRefs: evidenceRefsSchema }).strict(),
]);

const fieldMapReviewSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('current_approved'),
      fieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
  z
    .object({
      state: z.enum(['missing', 'superseded']),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
]);

const sourceUseSchema = z
  .object({
    state: z.enum(['permitted_private_calculation', 'not_permitted', 'unreviewed']),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const factualReviewSchema = z
  .object({
    state: z.enum(['current_approved', 'missing', 'disputed', 'superseded']),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const canonicalIdentitySchema = z
  .object({
    state: z.enum(['current_approved', 'not_applicable', 'incomplete']),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const blockerSchema = z.enum([
  'canonical_identity_not_current',
  'factual_review_not_current',
  'field_map_not_current',
  'raw_field_missing',
  'source_use_not_permitted',
]);
const reportBlockerSchema = z.enum([
  'method_not_authenticated',
  'required_source_missing',
]);
const evidenceProfileSchema = z
  .object({
    state: z.enum(['single_source', 'corroborated']),
    limitations: z
      .array(z.literal('no_independent_player_stats_corroboration'))
      .max(1),
  })
  .strict();

const assessmentInputSchema = z
  .object({
    semanticField: semanticFieldSchema,
    sourceFields: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
    rawAvailability: rawAvailabilitySchema,
    fieldMapReview: fieldMapReviewSchema,
    sourceUse: sourceUseSchema,
    factualReview: factualReviewSchema,
    canonicalIdentity: canonicalIdentitySchema,
  })
  .strict();

export type AflTradeHpnCalculationFieldAssessmentInput = z.input<
  typeof assessmentInputSchema
>;

const assessmentSchema = assessmentInputSchema.extend({
  state: z.enum(['eligible', 'blocked']),
  blockers: z.array(blockerSchema).max(5),
});

const sourceBase = {
  inputKind: z.enum(['completed_match_result', 'player_match_stats']),
  role: z.enum(['primary', 'corroborating']).nullable(),
  selectionEvidenceRefs: evidenceRefsSchema,
};

const sourceSchema = z
  .discriminatedUnion('selectionState', [
    z
      .object({
        ...sourceBase,
        selectionState: z.literal('selected'),
        normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
        provider: publicIdSchema,
        fields: z.array(assessmentSchema).min(1).max(30),
      })
      .strict(),
    z
      .object({
        ...sourceBase,
        selectionState: z.literal('missing'),
        normalizationRunId: z.null(),
        provider: z.null(),
      })
      .strict(),
  ])
  .superRefine((source, context) => {
    if (
      (source.inputKind === 'completed_match_result' && source.role !== null) ||
      (source.inputKind === 'player_match_stats' && source.role === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'Only player-stat sources have primary or corroborating roles.',
      });
    }
    if (source.selectionState === 'selected') {
      const expected = listAflTradeHpnRequiredSemanticFields(source.inputKind);
      const actual = source.fields.map(({ semanticField }) => semanticField);
      if (
        actual.length !== expected.length ||
        actual.some((fieldName, index) => fieldName !== expected[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fields'],
          message:
            'Each selected source must assess every required HPN semantic field exactly once.',
        });
      }
      const approvedMapIds = source.fields.flatMap(({ fieldMapReview }) =>
        fieldMapReview.state === 'current_approved' ? [fieldMapReview.fieldMapId] : []
      );
      if (new Set(approvedMapIds).size > 1) {
        context.addIssue({
          code: 'custom',
          path: ['fields'],
          message: 'One source run cannot be assessed through multiple current field maps.',
        });
      }
    }
  });

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_CALCULATION_ELIGIBILITY_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav'),
    valuationScopeKey: publicIdSchema,
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    methodSelection: aflTradeHpnCalculationMethodSelectionSchema,
    authoritySnapshotArtifact: aflTradeArtifactRefSchema,
    sources: z.array(sourceSchema).length(3),
    state: z.enum(['eligible', 'blocked']),
    blockers: z.array(reportBlockerSchema).max(2),
    evidenceProfile: evidenceProfileSchema,
    counts: z
      .object({
        totalFields: z.number().int().nonnegative(),
        eligibleFields: z.number().int().nonnegative(),
        blockedFields: z.number().int().nonnegative(),
        requiredFields: z.number().int().nonnegative(),
        blockedRequiredFields: z.number().int().nonnegative(),
        optionalFields: z.number().int().nonnegative(),
        blockedOptionalFields: z.number().int().nonnegative(),
      })
      .strict(),
    evaluatedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Eligibility evidence only; not a calculation, factual release, model approval, publication candidate, production authority, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const resultSources = content.sources.filter(
      ({ inputKind }) => inputKind === 'completed_match_result'
    );
    const primarySources = content.sources.filter(({ role }) => role === 'primary');
    const corroboratingSources = content.sources.filter(
      ({ role }) => role === 'corroborating'
    );
    if (
      resultSources.length !== 1 ||
      primarySources.length !== 1 ||
      corroboratingSources.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message:
          'Eligibility requires exactly one result, primary-player, and corroborating-player source slot.',
      });
    }
    const assessments = content.sources.flatMap((source) =>
      source.selectionState === 'selected' ? source.fields : []
    );
    const requiredAssessments = content.sources.flatMap((source) =>
      source.selectionState === 'selected' && source.role !== 'corroborating'
        ? source.fields
        : []
    );
    const optionalAssessments = content.sources.flatMap((source) =>
      source.selectionState === 'selected' && source.role === 'corroborating'
        ? source.fields
        : []
    );
    const eligibleFields = assessments.filter(({ state }) => state === 'eligible').length;
    const blockedFields = assessments.length - eligibleFields;
    const blockedRequiredFields = requiredAssessments.filter(
      ({ state }) => state === 'blocked'
    ).length;
    const blockedOptionalFields = optionalAssessments.filter(
      ({ state }) => state === 'blocked'
    ).length;
    const requiredSourceMissing = [...resultSources, ...primarySources].some(
      ({ selectionState }) => selectionState === 'missing'
    );
    const expectedBlockers: z.infer<typeof reportBlockerSchema>[] = [];
    if (content.methodSelection.state === 'missing') {
      expectedBlockers.push('method_not_authenticated');
    }
    if (requiredSourceMissing) expectedBlockers.push('required_source_missing');
    const primary = primarySources[0];
    const corroborating = corroboratingSources[0];
    const independentlyCorroborated =
      primary?.selectionState === 'selected' &&
      corroborating?.selectionState === 'selected' &&
      primary.provider !== corroborating.provider &&
      blockedOptionalFields === 0;
    const expectedEvidenceProfile = independentlyCorroborated
      ? { state: 'corroborated' as const, limitations: [] }
      : {
          state: 'single_source' as const,
          limitations: ['no_independent_player_stats_corroboration' as const],
        };
    if (
      content.counts.totalFields !== assessments.length ||
      content.counts.eligibleFields !== eligibleFields ||
      content.counts.blockedFields !== blockedFields ||
      content.counts.requiredFields !== requiredAssessments.length ||
      content.counts.blockedRequiredFields !== blockedRequiredFields ||
      content.counts.optionalFields !== optionalAssessments.length ||
      content.counts.blockedOptionalFields !== blockedOptionalFields ||
      JSON.stringify(content.blockers) !== JSON.stringify(expectedBlockers) ||
      JSON.stringify(content.evidenceProfile) !== JSON.stringify(expectedEvidenceProfile) ||
      content.state !==
        (blockedRequiredFields === 0 && expectedBlockers.length === 0
          ? 'eligible'
          : 'blocked')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message:
          'Eligibility state, blockers, and counts must equal the exact method and field assessments.',
      });
    }
    const evidence = [
      content.authoritySnapshotArtifact,
      ...(content.methodSelection.state === 'authenticated'
        ? [content.methodSelection.methodArtifact]
        : content.methodSelection.evidenceRefs),
      ...content.sources.flatMap(({ selectionEvidenceRefs }) => selectionEvidenceRefs),
      ...assessments.flatMap((assessment) => [
        ...assessment.rawAvailability.evidenceRefs,
        ...assessment.fieldMapReview.evidenceRefs,
        ...assessment.sourceUse.evidenceRefs,
        ...assessment.factualReview.evidenceRefs,
        ...assessment.canonicalIdentity.evidenceRefs,
      ]),
    ];
    if (evidence.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(content.evaluatedAt))) {
      context.addIssue({
        code: 'custom',
        message: 'Eligibility evidence must exist before the trusted evaluation time.',
      });
    }
  });

export const aflTradeHpnCalculationEligibilityReportSchema = z
  .object({
    reportId: aflTradeContentAddressedIdSchema('hpn-calculation-eligibility'),
    content: contentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'hpn-calculation-eligibility',
      report.reportId,
      report.content,
      context,
      ['reportId']
    );
  });

export type AflTradeHpnCalculationEligibilityReport = z.infer<
  typeof aflTradeHpnCalculationEligibilityReportSchema
>;

function isIdentityField(field: AflTradeHpnRequiredSemanticField): boolean {
  return ['player', 'match', 'club', 'homeClub', 'awayClub'].includes(field);
}

function assess(input: AflTradeHpnCalculationFieldAssessmentInput) {
  const parsed = assessmentInputSchema.parse(input);
  const blockers: z.infer<typeof blockerSchema>[] = [];
  if (parsed.canonicalIdentity.state !== (isIdentityField(parsed.semanticField) ? 'current_approved' : 'not_applicable')) {
    blockers.push('canonical_identity_not_current');
  }
  if (parsed.factualReview.state !== 'current_approved') {
    blockers.push('factual_review_not_current');
  }
  if (parsed.fieldMapReview.state !== 'current_approved') {
    blockers.push('field_map_not_current');
  }
  if (parsed.rawAvailability.state !== 'available') blockers.push('raw_field_missing');
  if (parsed.sourceUse.state !== 'permitted_private_calculation') {
    blockers.push('source_use_not_permitted');
  }
  blockers.sort();
  return assessmentSchema.parse({
    ...parsed,
    state: blockers.length === 0 ? 'eligible' : 'blocked',
    blockers,
  });
}

export function createAflTradeHpnCalculationEligibilityReport(input: {
  readonly valuationScopeKey: string;
  readonly seasonYear: number;
  readonly method:
    | {
        readonly state: 'authenticated';
        readonly method: unknown;
        readonly methodArtifact: AflTradeArtifactRef;
      }
    | {
        readonly state: 'missing';
        readonly evidenceRefs: readonly AflTradeArtifactRef[];
      };
  readonly authoritySnapshotArtifact: AflTradeArtifactRef;
  readonly sources: readonly (
    | {
        readonly selectionState: 'selected';
        readonly normalizationRunId: string;
        readonly provider: string;
        readonly inputKind: 'completed_match_result' | 'player_match_stats';
        readonly role: 'primary' | 'corroborating' | null;
        readonly selectionEvidenceRefs: readonly AflTradeArtifactRef[];
        readonly fields: readonly AflTradeHpnCalculationFieldAssessmentInput[];
      }
    | {
        readonly selectionState: 'missing';
        readonly normalizationRunId: null;
        readonly provider: null;
        readonly inputKind: 'completed_match_result' | 'player_match_stats';
        readonly role: 'primary' | 'corroborating' | null;
        readonly selectionEvidenceRefs: readonly AflTradeArtifactRef[];
      }
  )[];
  readonly evaluatedAt: string;
}): AflTradeHpnCalculationEligibilityReport {
  let methodSelection: AflTradeHpnCalculationMethodSelection;
  if (input.method.state === 'authenticated') {
    const method = aflTradeHpnPavMethodSchema.parse(input.method.method);
    if (!doesAflTradeArtifactRefMatchCanonicalJson(input.method.methodArtifact, method)) {
      throw new TypeError('The eligibility report requires the exact retained HPN method document.');
    }
    methodSelection = {
      state: 'authenticated',
      methodId: method.methodId,
      methodArtifact: input.method.methodArtifact,
    };
  } else {
    methodSelection = aflTradeHpnCalculationMethodSelectionSchema.parse({
      state: 'missing',
      methodId: null,
      evidenceRefs: input.method.evidenceRefs,
    });
  }
  const sources = input.sources
    .map((source) =>
      source.selectionState === 'selected'
        ? {
            ...source,
            fields: source.fields
              .map(assess)
              .sort((left, right) => left.semanticField.localeCompare(right.semanticField)),
          }
        : source
    )
    .sort((left, right) => {
      const slot = (source: (typeof sources)[number]) =>
        source.inputKind === 'completed_match_result'
          ? '0'
          : source.role === 'primary'
            ? '1'
            : '2';
      return slot(left).localeCompare(slot(right));
    });
  const assessments = sources.flatMap((source) =>
    source.selectionState === 'selected' ? source.fields : []
  );
  const requiredAssessments = sources.flatMap((source) =>
    source.selectionState === 'selected' && source.role !== 'corroborating'
      ? source.fields
      : []
  );
  const optionalAssessments = sources.flatMap((source) =>
    source.selectionState === 'selected' && source.role === 'corroborating'
      ? source.fields
      : []
  );
  const eligibleFields = assessments.filter(({ state }) => state === 'eligible').length;
  const blockedFields = assessments.length - eligibleFields;
  const blockedRequiredFields = requiredAssessments.filter(
    ({ state }) => state === 'blocked'
  ).length;
  const blockedOptionalFields = optionalAssessments.filter(
    ({ state }) => state === 'blocked'
  ).length;
  const result = sources.find(({ inputKind }) => inputKind === 'completed_match_result');
  const primary = sources.find(({ role }) => role === 'primary');
  const corroborating = sources.find(({ role }) => role === 'corroborating');
  const blockers: z.infer<typeof reportBlockerSchema>[] = [];
  if (methodSelection.state === 'missing') blockers.push('method_not_authenticated');
  if (result?.selectionState === 'missing' || primary?.selectionState === 'missing') {
    blockers.push('required_source_missing');
  }
  const evidenceProfile =
    primary?.selectionState === 'selected' &&
    corroborating?.selectionState === 'selected' &&
    primary.provider !== corroborating.provider &&
    blockedOptionalFields === 0
      ? { state: 'corroborated' as const, limitations: [] }
      : {
          state: 'single_source' as const,
          limitations: ['no_independent_player_stats_corroboration' as const],
        };
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_CALCULATION_ELIGIBILITY_SCHEMA_VERSION,
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav',
    valuationScopeKey: input.valuationScopeKey,
    competition: 'AFLM',
    seasonYear: input.seasonYear,
    methodSelection,
    authoritySnapshotArtifact: input.authoritySnapshotArtifact,
    sources,
    state:
      blockedRequiredFields === 0 && blockers.length === 0 ? 'eligible' : 'blocked',
    blockers,
    evidenceProfile,
    counts: {
      totalFields: assessments.length,
      eligibleFields,
      blockedFields,
      requiredFields: requiredAssessments.length,
      blockedRequiredFields,
      optionalFields: optionalAssessments.length,
      blockedOptionalFields,
    },
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Eligibility evidence only; not a calculation, factual release, model approval, publication candidate, production authority, or activation authority.',
  });
  return aflTradeHpnCalculationEligibilityReportSchema.parse({
    reportId: createAflTradeContentAddress('hpn-calculation-eligibility', content),
    content,
  });
}
