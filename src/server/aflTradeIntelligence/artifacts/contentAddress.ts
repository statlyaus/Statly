import { createHash } from 'node:crypto';

import { z } from 'zod';

export type AflTradeCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | AflTradeCanonicalJsonValue[]
  | { [key: string]: AflTradeCanonicalJsonValue };

export const aflTradeSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function assertPlainObject(value: object): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Canonical JSON accepts only arrays and plain objects.');
  }
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not accept non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError('Canonical JSON does not accept undefined, bigint, symbols, or functions.');
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not accept cycles.');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError('Canonical JSON does not accept sparse arrays.');
      }
      return `[${value.map((entry) => canonicalize(entry, ancestors)).join(',')}]`;
    }

    assertPlainObject(value);
    const properties = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`);
    return `{${properties.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Produces deterministic JSON for the deliberately narrow JSON value domain used by immutable AFL
 * trade-intelligence artifacts. It is an integrity primitive, not proof of authority or authorship.
 */
export function canonicalizeAflTradeJson(value: unknown): string {
  return canonicalize(value, new WeakSet());
}

export function sha256AflTradeCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalizeAflTradeJson(value), 'utf8').digest('hex');
}

export function createAflTradeContentAddress(prefix: string, content: unknown): string {
  if (!/^[a-z][a-z0-9-]*$/.test(prefix)) {
    throw new TypeError(
      'Content-address prefixes must use lowercase letters, digits, and hyphens.'
    );
  }
  return `${prefix}:${sha256AflTradeCanonicalJson(content)}`;
}

export function aflTradeContentAddressedIdSchema(prefix: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(prefix)) {
    throw new TypeError(
      'Content-address prefixes must use lowercase letters, digits, and hyphens.'
    );
  }
  return z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
}

export function isAflTradeContentAddress(
  prefix: string,
  identifier: string,
  content: unknown
): boolean {
  return identifier === createAflTradeContentAddress(prefix, content);
}

export function addAflTradeContentAddressIssue(
  prefix: string,
  identifier: string,
  content: unknown,
  context: z.RefinementCtx,
  path: (string | number)[]
) {
  try {
    if (!isAflTradeContentAddress(prefix, identifier, content)) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Identifier must equal the canonical ${prefix} content address.`,
      });
    }
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path,
      message: error instanceof Error ? error.message : 'Content cannot be canonically hashed.',
    });
  }
}
