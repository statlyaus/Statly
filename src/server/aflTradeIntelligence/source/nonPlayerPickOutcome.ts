import { z } from 'zod';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
const year = z.number().int().min(1988).max(2200);
const draftType = z.string().trim().min(1).max(80);
export const nonPlayerPickOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('passed'),draftYear:year,draftType,livePick:z.number().int().positive()}).strict(),
  z.object({kind:z.literal('not_exercised'),draftYear:year,draftType,recordedPick:z.number().int().positive()}).strict(),
  z.object({kind:z.literal('incorporated_into_later_package'),onwardTransactionIds:z.array(aflTradeContentAddressedIdSchema('external-transaction')).max(100),packageDescription:z.string().trim().min(1).max(4000)}).strict(),
]);
