import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeFinalizedHpnPavCalculationSchema } from './hpnPavCalculationService';
import { aflTradePlayerPavValueSchema } from './playerPavObservationContracts';
import { AflTradePlayerPavObservationError } from './playerPavObservationRepository';
import type { AflTradePlayerPavCalculationEvidence } from './playerPavObservationService';

const selectionSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    seasonYears: z.array(z.number().int().min(1998).max(2200)).min(1).max(203),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/**
 * Convert retained HPN season measurements without fitting, rescaling or filling missing values.
 * Callers still authenticate current source, method, release and durable finalization authority.
 */
export function createAflTradePlayerPavCalculationEvidence(
  input: z.input<typeof selectionSchema> & { readonly calculation: unknown }
): AflTradePlayerPavCalculationEvidence {
  try {
    const { calculation: unparsedCalculation, ...unparsedSelection } = input;
    const selection = selectionSchema.parse(unparsedSelection);
    const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(unparsedCalculation);
    const content = calculation.content;
    const cutoff = Date.parse(selection.knowledgeCutoffAt);
    if (
      content.environment !== selection.environment ||
      content.competition !== selection.competition ||
      content.methodId !== selection.methodId ||
      content.inputSetId !== `hpn-pav-input-set:${content.inputSetSha256}` ||
      new Set(content.players.map(({ spellVersionId }) => spellVersionId)).size !==
        content.players.length ||
      !selection.seasonYears.includes(content.seasonYear) ||
      Date.parse(content.calculatedAt) > cutoff ||
      Date.parse(content.effectiveThrough) > cutoff
    ) {
      throw new TypeError('The selected calculation has a different scope or cutoff.');
    }
    const calculationSha256 = calculation.calculationId.slice('hpn-pav-season:'.length);
    const membership = {
      calculationId: calculation.calculationId,
      calculationSha256,
      inputSetId: calculation.content.inputSetId,
      methodId: calculation.content.methodId,
      seasonYear: calculation.content.seasonYear,
      effectiveThrough: calculation.content.effectiveThrough,
      calculatedAt: calculation.content.calculatedAt,
    };
    return {
      calculation: membership,
      playerValues: calculation.content.players.map((player) =>
        aflTradePlayerPavValueSchema.parse({
          calculationId: membership.calculationId,
          calculationSha256,
          seasonYear: membership.seasonYear,
          effectiveThrough: membership.effectiveThrough,
          calculatedAt: membership.calculatedAt,
          spellVersionId: player.spellVersionId,
          playerId: player.playerId,
          playerSha256: sha256AflTradeCanonicalJson(player),
          clubId: player.teamId,
          sourceRowIds: player.source.sourceRowIds,
          gamesPlayed: player.source.gamesPlayed,
          offensivePav: player.offensivePav,
          midfieldPav: player.midfieldPav,
          defensivePav: player.defensivePav,
          totalPav: player.totalPav,
        })
      ),
    };
  } catch {
    throw new AflTradePlayerPavObservationError(
      'CALCULATION_EVIDENCE_INCOMPLETE',
      'Selected player-PAV calculation evidence failed content, scope or measurement validation.'
    );
  }
}
