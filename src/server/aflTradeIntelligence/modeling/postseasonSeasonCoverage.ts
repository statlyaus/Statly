import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-postseason-season-coverage/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    state: z.enum(['complete', 'partial']),
    expectedMatchIds: z.array(z.string().min(1).max(240)).min(1).max(1000),
    evidence: aflTradeArtifactRefSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.expectedMatchIds.some(
        (id, index) => index > 0 && id <= value.expectedMatchIds[index - 1]!
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Expected season matches must be unique and sorted.',
      });
    if (Date.parse(value.evidence.createdAt) > Date.parse(value.createdAt))
      ctx.addIssue({ code: 'custom', message: 'Coverage review cannot precede its evidence.' });
  });

export const aflTradePostseasonSeasonCoverageSchema = z
  .object({
    coverageId: aflTradeContentAddressedIdSchema('postseason-season-coverage'),
    content: contentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    addAflTradeContentAddressIssue(
      'postseason-season-coverage',
      record.coverageId,
      record.content,
      ctx,
      ['coverageId']
    );
  });

export function createAflTradePostseasonSeasonCoverage(input: z.input<typeof contentSchema>) {
  const content = contentSchema.parse({
    ...input,
    expectedMatchIds: [...input.expectedMatchIds].sort(),
  });
  return aflTradePostseasonSeasonCoverageSchema.parse({
    coverageId: createAflTradeContentAddress('postseason-season-coverage', content),
    content,
  });
}

/** One review chain per scoped season and method; replacement evidence must supersede its predecessor. */
export function aflTradePostseasonCoverageSubject(
  input: Pick<
    z.infer<typeof contentSchema>,
    'environment' | 'competition' | 'seasonYear' | 'methodId'
  >
) {
  return `${input.environment}:${input.competition}:${input.seasonYear}:${input.methodId}`;
}
