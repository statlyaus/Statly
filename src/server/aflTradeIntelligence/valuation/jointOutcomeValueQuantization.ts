import { z } from 'zod';

export const AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION =
  'ecmascript_canonical_decimal_half_away_from_zero_v1' as const;

export const aflTradeJointOutcomeValueQuantizationPolicySchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION),
    decimalPlaces: z.number().int().min(0).max(9),
  })
  .strict();

export type AflTradeJointOutcomeValueQuantizationPolicy = z.infer<
  typeof aflTradeJointOutcomeValueQuantizationPolicySchema
>;

interface CanonicalDecimal {
  coefficient: bigint;
  decimalExponent: number;
}

function parseCanonicalDecimal(value: number): CanonicalDecimal {
  const serialized = Math.abs(value).toString().toLowerCase();
  const [significand, exponentText] = serialized.split('e');
  const [whole, fraction = ''] = significand.split('.');

  return {
    coefficient: BigInt(`${whole}${fraction}`),
    decimalExponent: Number(exponentText ?? 0) - fraction.length,
  };
}

function roundHalfAwayFromZero(coefficient: bigint, scaledDecimalExponent: number): bigint {
  if (scaledDecimalExponent >= 0) {
    return coefficient * 10n ** BigInt(scaledDecimalExponent);
  }

  const divisor = 10n ** BigInt(-scaledDecimalExponent);
  const quotient = coefficient / divisor;
  const remainder = coefficient % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

export function quantizeAflTradeJointOutcomeValue(
  unparsedValue: number,
  unparsedPolicy: AflTradeJointOutcomeValueQuantizationPolicy
): number {
  const value = z.number().finite().parse(unparsedValue);
  const policy = aflTradeJointOutcomeValueQuantizationPolicySchema.parse(unparsedPolicy);
  const { coefficient, decimalExponent } = parseCanonicalDecimal(value);
  const magnitude = roundHalfAwayFromZero(coefficient, decimalExponent + policy.decimalPlaces);
  const signed = value < 0 ? -magnitude : magnitude;

  if (signed < BigInt(Number.MIN_SAFE_INTEGER) || signed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Quantized AFL trade value must be a safe integer.');
  }

  return Number(signed);
}
