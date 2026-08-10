import { createHash } from 'node:crypto';

import { z } from 'zod';

import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';

import {
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

export const AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_SCHEMA_VERSION =
  'afl-trade-factual-projection-item-set/v1' as const;
export const AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_BOUNDARY =
  'searchable_public_list_rows_no_exports_valuation_or_fantasy_ownership' as const;

const postgresBigintMaximum = 9_223_372_036_854_775_807n;
const ordinalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => BigInt(value) <= postgresBigintMaximum, 'Ordinal exceeds PostgreSQL BIGINT.');
const itemKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeFactualProjectionItemMemberSchema = z
  .object({
    ordinal: ordinalSchema,
    itemKey: itemKeySchema,
    itemSha256: aflTradeSha256Schema,
    canonicalItemJson: z.string().min(2).max(1_000_000),
    item: aflDraftTradeOutcomeListItemSchema,
  })
  .strict()
  .superRefine((member, context) => {
    const canonical = canonicalizeAflTradeJson(member.item);
    if (member.canonicalItemJson !== canonical) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalItemJson'],
        message: 'Projection item canonical JSON does not match its public item.',
      });
    }
    if (member.itemSha256 !== sha256AflTradeCanonicalJson(member.item)) {
      context.addIssue({
        code: 'custom',
        path: ['itemSha256'],
        message: 'Projection item digest does not match its public item.',
      });
    }
  });

export type AflTradeFactualProjectionItemMember = z.infer<
  typeof aflTradeFactualProjectionItemMemberSchema
>;

function membershipPreimage(
  members: readonly Pick<
    AflTradeFactualProjectionItemMember,
    'ordinal' | 'itemKey' | 'itemSha256'
  >[]
): string {
  return [
    AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_SCHEMA_VERSION,
    AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_BOUNDARY,
    String(members.length),
    ...members.flatMap(({ ordinal, itemKey, itemSha256 }) => [ordinal, itemKey, itemSha256]),
  ].join('\n');
}

export function sha256AflTradeFactualProjectionItemMembership(
  members: readonly Pick<
    AflTradeFactualProjectionItemMember,
    'ordinal' | 'itemKey' | 'itemSha256'
  >[]
): string {
  return createHash('sha256').update(membershipPreimage(members), 'utf8').digest('hex');
}

export const aflTradeFactualProjectionItemSetSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_SCHEMA_VERSION),
    boundary: z.literal(AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_BOUNDARY),
    itemCount: z.number().int().nonnegative().max(100_000),
    itemSetSha256: aflTradeSha256Schema,
    members: z.array(aflTradeFactualProjectionItemMemberSchema).max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    if (set.itemCount !== set.members.length) {
      context.addIssue({
        code: 'custom',
        path: ['itemCount'],
        message: 'Projection item count must equal its exact membership.',
      });
    }
    const ordinals = set.members.map(({ ordinal }) => ordinal);
    const itemKeys = set.members.map(({ itemKey }) => itemKey);
    if (new Set(ordinals).size !== ordinals.length || new Set(itemKeys).size !== itemKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Projection item ordinals and keys must each be unique.',
      });
    }
    for (let index = 1; index < set.members.length; index += 1) {
      const previous = set.members[index - 1];
      const current = set.members[index];
      const ordinalDifference = BigInt(previous.ordinal) - BigInt(current.ordinal);
      if (
        ordinalDifference > 0n ||
        (ordinalDifference === 0n && previous.itemKey.localeCompare(current.itemKey) >= 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['members', index],
          message: 'Projection items must use canonical ordinal and key order.',
        });
        break;
      }
    }
    if (set.itemSetSha256 !== sha256AflTradeFactualProjectionItemMembership(set.members)) {
      context.addIssue({
        code: 'custom',
        path: ['itemSetSha256'],
        message: 'Projection item-set digest does not match its exact membership.',
      });
    }
  });

export type AflTradeFactualProjectionItemSet = z.infer<
  typeof aflTradeFactualProjectionItemSetSchema
>;

export function createAflTradeFactualProjectionItemSet(
  rows: readonly {
    ordinal: string | number | bigint;
    itemKey: string;
    item: unknown;
  }[]
): AflTradeFactualProjectionItemSet {
  const members = rows
    .map(({ ordinal, itemKey, item }) => {
      const parsedItem = aflDraftTradeOutcomeListItemSchema.parse(item);
      return aflTradeFactualProjectionItemMemberSchema.parse({
        ordinal: String(ordinal),
        itemKey,
        itemSha256: sha256AflTradeCanonicalJson(parsedItem),
        canonicalItemJson: canonicalizeAflTradeJson(parsedItem),
        item: parsedItem,
      });
    })
    .sort((left, right) => {
      const ordinalDifference = BigInt(left.ordinal) - BigInt(right.ordinal);
      if (ordinalDifference !== 0n) return ordinalDifference < 0n ? -1 : 1;
      return left.itemKey.localeCompare(right.itemKey);
    });
  return aflTradeFactualProjectionItemSetSchema.parse({
    schemaVersion: AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_SCHEMA_VERSION,
    boundary: AFL_TRADE_FACTUAL_PROJECTION_ITEM_SET_BOUNDARY,
    itemCount: members.length,
    itemSetSha256: sha256AflTradeFactualProjectionItemMembership(members),
    members,
  });
}
