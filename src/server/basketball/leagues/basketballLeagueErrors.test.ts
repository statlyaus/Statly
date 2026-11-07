import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BasketballLeagueError,
  toBasketballErrorResponse,
  toValidationError,
} from './basketballLeagueErrors';

describe('toBasketballErrorResponse', () => {
  it.each([
    ['UNAUTHORIZED', 401],
    ['VALIDATION', 400],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['INTERNAL', 500],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    const response = toBasketballErrorResponse(new BasketballLeagueError(code, 'Nope'));

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ success: false, error: { code, message: 'Nope' } });
  });

  it('hides the message of an unexpected error behind a 500', () => {
    const response = toBasketballErrorResponse(new Error('connection string leaked'));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(response.body)).not.toContain('connection string');
  });

  it.each(['P2002', 'P2003', 'P2025'])(
    'turns a concurrent-change Prisma error %s into a 409',
    (code) => {
      const race = new Prisma.PrismaClientKnownRequestError('Concurrent change', {
        code,
        clientVersion: 'test',
      });

      expect(toBasketballErrorResponse(race).status).toBe(409);
    }
  );
});

describe('toValidationError', () => {
  it('reports each failing field by its dotted path', () => {
    const schema = z.object({
      name: z.string().min(1),
      slots: z.object({ PG: z.number().max(10) }),
    });
    const parsed = schema.safeParse({ name: '', slots: { PG: 11 } });
    if (parsed.success) throw new Error('expected failure');

    const error = toValidationError(parsed.error);

    expect(error.status).toBe(400);
    expect(error.details).toEqual({
      formErrors: [],
      fieldErrors: {
        name: [expect.any(String)],
        'slots.PG': [expect.any(String)],
      },
    });
  });

  it('puts whole-object problems in formErrors', () => {
    const schema = z.object({ a: z.number() }).refine(() => false, 'Never valid');
    const parsed = schema.safeParse({ a: 1 });
    if (parsed.success) throw new Error('expected failure');

    expect(toValidationError(parsed.error).details).toEqual({
      formErrors: ['Never valid'],
      fieldErrors: {},
    });
  });
});
