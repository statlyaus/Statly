import { z } from 'zod';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import { aflTradePostseasonObservationMaterializationRequestSchema } from '../../modeling/postgresPostseasonObservationMaterialization';
import { aflTradePostseasonPlayerPavObservationSchema } from '../../modeling/postseasonPlayerPavObservation';
import { aflTradePostseasonValuationCaseSchema } from '../postseasonValuationCase';
import { postseasonValuationParentsSchema } from '../postseasonValuationParents';
import { createAflTradeLineageGraphId } from '../valuationCaseContracts';

export const postseasonMaterializationRequestSchema = z
  .object({
    kind: z.enum(['observation', 'complete_trade']),
    selection: aflTradePostseasonObservationMaterializationRequestSchema,
  })
  .strict();

const coverageBinding = z
  .object({
    seasonYear: z.number().int(),
    coverageId: aflTradeContentAddressedIdSchema('postseason-season-coverage').nullable(),
    reviewDecisionId: z.string().min(1).max(240).nullable(),
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season').nullable(),
  })
  .strict()
  .superRefine((binding, ctx) => {
    const absent = [binding.coverageId, binding.reviewDecisionId, binding.calculationId].filter(
      (value) => value === null
    ).length;
    if (absent !== 0 && absent !== 3)
      ctx.addIssue({
        code: 'custom',
        message: 'Coverage absence must be explicit for every authority binding.',
      });
  });

const contentSchema = z
  .object({
    schemaVersion: z.literal('private-evaluation-materialization-manifest/v2'),
    environment: z.enum(['test_fixture', 'non_production']),
    selector: z
      .object({
        valuationScopeKey: z.string().min(1).max(1000),
        tradeId: z.string().min(1).max(1000),
      })
      .strict(),
    requestKey: aflTradeContentAddressedIdSchema('postseason-materialization-request'),
    request: postseasonMaterializationRequestSchema,
    policyApprovalDecisionId: z.string().min(1).max(240),
    coverageBindings: z.array(coverageBinding).min(4).max(6),
    observation: aflTradePostseasonPlayerPavObservationSchema,
    valuationCase: aflTradePostseasonValuationCaseSchema.nullable(),
    valuationParents: postseasonValuationParentsSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    authorityBoundary: z.literal('private_factual_materialization_no_numerical_admission'),
  })
  .strict()
  .superRefine((content, ctx) => {
    const observation = content.observation.content;
    const context = observation.context.content;
    if (
      content.requestKey !==
        createAflTradeContentAddress('postseason-materialization-request', content.request) ||
      content.environment !== content.request.selection.environment ||
      content.environment !== context.environment ||
      content.selector.tradeId !== context.tradeId ||
      content.request.selection.reviewDecisionId !== context.reviewDecisionId ||
      content.request.selection.knowledgeCutoffAt !== context.knowledgeCutoffAt ||
      Date.parse(content.createdAt) < Date.parse(context.knowledgeCutoffAt) ||
      (content.request.kind === 'complete_trade') !== (content.valuationCase !== null) ||
      (content.valuationCase !== null) !== (content.valuationParents !== null) ||
      (content.valuationCase !== null &&
        canonicalizeAflTradeJson(content.valuationCase.content.context) !==
          canonicalizeAflTradeJson(observation.context))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Materialization request, context and result bindings differ.',
      });
    if (content.valuationCase && content.valuationParents) {
      const value = content.valuationCase.content;
      const parents = content.valuationParents;
      const draws = parents.componentDrawSet;
      if (
        value.componentDrawSetId !== draws.componentDrawSetId ||
        value.realizedContributionLedgerId !==
          parents.realizedContributionLedger.realizedContributionLedgerId ||
        value.packagePolicyId !== parents.packagePolicy.packagePolicyId ||
        value.lineageGraphId !== createAflTradeLineageGraphId(parents.lineageGraph) ||
        value.valuationBundleId !== draws.content.valuationBundleId ||
        value.valuationInputBundleId !== draws.content.valuationInputBundleId ||
        value.valueUnitId !== draws.content.valueUnitId
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Valuation case differs from its exact retained parents.',
        });
    }
    const years = [...observation.features, ...observation.outcomes].map(
      (value) => value.seasonYear
    );
    if (
      canonicalizeAflTradeJson(years) !==
      canonicalizeAflTradeJson(content.coverageBindings.map((value) => value.seasonYear))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Coverage bindings must preserve every original feature/outcome season.',
      });
  });

export const postseasonMaterializationManifestSchema = z
  .object({
    manifestId: aflTradeContentAddressedIdSchema('private-evaluation-materialization-manifest'),
    content: contentSchema,
  })
  .strict()
  .superRefine((record, ctx) =>
    addAflTradeContentAddressIssue(
      'private-evaluation-materialization-manifest',
      record.manifestId,
      record.content,
      ctx,
      ['manifestId']
    )
  );

export function createPostseasonMaterializationManifest(input: z.input<typeof contentSchema>) {
  const content = contentSchema.parse(input);
  return postseasonMaterializationManifestSchema.parse({
    manifestId: createAflTradeContentAddress(
      'private-evaluation-materialization-manifest',
      content
    ),
    content,
  });
}

export type PostseasonMaterializationManifest = z.infer<
  typeof postseasonMaterializationManifestSchema
>;
