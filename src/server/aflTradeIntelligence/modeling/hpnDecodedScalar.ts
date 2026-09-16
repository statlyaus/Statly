import { AflTradeHpnPavInputError } from './hpnPavInputRepository';

export function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is missing.`);
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AflTradeHpnPavInputError('SOURCE_AUTHORITY_MISMATCH', `${label} is invalid.`);
  }
  return value;
}

function numericScalar(
  scalar: Record<string, unknown>,
  field: string,
  kind: 'integer' | 'finite_number'
) {
  const grammar = kind === 'integer' ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (typeof scalar.value !== 'string' || !grammar.test(scalar.value)) {
    throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is not numeric.`);
  }
  const number = Number(scalar.value);
  if (!Number.isFinite(number)) {
    throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is not finite.`);
  }
  return number;
}

export function decodedScalar(payload: unknown, field: string): string | number | boolean | null {
  const retained = asObject(payload, 'typed payload');
  const enveloped = Object.hasOwn(retained, 'values');
  if (enveloped && Object.hasOwn(retained, field)) {
    throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is ambiguous.`);
  }
  const values = enveloped ? asObject(retained.values, 'typed payload values') : retained;
  const scalar = asObject(values[field], `typed field ${field}`);
  const kind = scalar.kind;
  if (['missing', 'nan', 'positive_infinity', 'negative_infinity'].includes(kind as string)) {
    if (Object.keys(scalar).length !== 1) {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is malformed.`);
    }
    return null;
  }
  if (kind === 'logical') {
    if (typeof scalar.value !== 'boolean') {
      throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} is not logical.`);
    }
    return scalar.value;
  }
  if (kind === 'integer' || kind === 'finite_number') {
    return numericScalar(scalar, field, kind);
  }
  if (['text', 'factor', 'date', 'datetime'].includes(kind as string)) {
    return asString(scalar.value, field);
  }
  throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', `${field} has an unsupported type.`);
}

export function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AflTradeHpnPavInputError(
      'INCOMPLETE_SOURCE_ROWS',
      `${field} must be an observed nonnegative integer.`
    );
  }
  return value;
}
