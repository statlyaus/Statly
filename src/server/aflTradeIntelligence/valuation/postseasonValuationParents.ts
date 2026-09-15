import { z } from 'zod';
import {
  AFL_TRADE_ASSET_TYPES,
  AFL_TRADE_LINEAGE_EDGE_KINDS,
  AFL_TRADE_ASSET_DISPOSITION_KINDS,
  AFL_TRADE_CORRECTION_RELATION_KINDS,
} from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';
import { aflTradeComponentDrawSetSchema } from './componentDrawSet';
import { aflTradePackagePolicySchema } from './packagePolicy';
import { aflTradeRealizedContributionLedgerSchema } from './realizedContributionLedger';
import { requireCommonModelBinding } from './valuationCaseMaterialization';

const instant = z.iso.datetime({ offset: true });
const identifier = z.string().trim().min(1).max(1000);
const known = { knownFrom: instant, knownTo: instant.nullable(), evidenceId: identifier };
export const postseasonLineageGraphSchema = z
  .object({
    assets: z
      .array(
        z
          .object({
            ...known,
            assetId: identifier,
            assetType: z.enum(AFL_TRADE_ASSET_TYPES),
            effectiveFrom: instant,
          })
          .strict()
      )
      .max(100000),
    custodySpells: z
      .array(
        z
          .object({
            ...known,
            custodySpellId: identifier,
            assetId: identifier,
            aflClubId: identifier,
            effectiveFrom: instant,
            effectiveTo: instant.nullable(),
          })
          .strict()
      )
      .max(100000),
    edges: z
      .array(
        z
          .object({
            ...known,
            edgeId: identifier,
            kind: z.enum(AFL_TRADE_LINEAGE_EDGE_KINDS),
            sourceAssetId: identifier,
            targetAssetId: identifier,
            effectiveAt: instant,
            ruleVersion: identifier,
          })
          .strict()
      )
      .max(100000),
    dispositions: z
      .array(
        z
          .object({
            ...known,
            dispositionId: identifier,
            kind: z.enum(AFL_TRADE_ASSET_DISPOSITION_KINDS),
            assetId: identifier,
            effectiveAt: instant,
            reasonCode: identifier,
          })
          .strict()
      )
      .max(100000),
    corrections: z
      .array(
        z
          .object({
            correctionId: identifier,
            kind: z.enum(AFL_TRADE_CORRECTION_RELATION_KINDS),
            supersededRecordId: identifier,
            replacementRecordId: identifier,
            knownAt: instant,
            evidenceId: identifier,
          })
          .strict()
      )
      .max(100000),
  })
  .strict();

/** Exact retained documents required to verify and restore a complete case. */
export const postseasonValuationParentsSchema = z
  .object({
    componentDrawSet: aflTradeComponentDrawSetSchema,
    realizedContributionLedger: aflTradeRealizedContributionLedgerSchema,
    packagePolicy: aflTradePackagePolicySchema,
    lineageGraph: postseasonLineageGraphSchema,
  })
  .strict()
  .superRefine((parents, ctx) => {
    if (!validateAflTradeLineageGraph(parents.lineageGraph).valid)
      ctx.addIssue({ code: 'custom', message: 'Valuation lineage is invalid.' });
    try {
      requireCommonModelBinding(parents);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Valuation parents require one exact model and lineage binding.',
      });
    }
  });
