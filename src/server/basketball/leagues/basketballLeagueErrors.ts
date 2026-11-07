import { Prisma } from '@prisma/client';
import type { z } from 'zod';

export type BasketballLeagueErrorCode =
  'UNAUTHORIZED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

const STATUS: Record<BasketballLeagueErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Field errors keyed by dotted path (`rosterSlots.PG`, `entries.2.teamId`); `formErrors` for the whole input. */
export interface BasketballFieldErrors {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}

// Unique clash, foreign key gone, or row gone: another write to the same league landed first.
const CONCURRENT_CHANGE_CODES = new Set(['P2002', 'P2003', 'P2025']);

export class BasketballLeagueError extends Error {
  readonly code: BasketballLeagueErrorCode;
  readonly status: number;
  readonly details?: BasketballFieldErrors;

  constructor(code: BasketballLeagueErrorCode, message: string, details?: BasketballFieldErrors) {
    super(message);
    this.name = 'BasketballLeagueError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

/** The one not-found answer for a missing league and for someone else's league, so neither leaks. */
export function leagueNotFound(): BasketballLeagueError {
  return new BasketballLeagueError('NOT_FOUND', 'League not found');
}

/** A 400 with one field error, for rules checked against stored state rather than by zod. */
export function fieldError(path: string, message: string): BasketballLeagueError {
  return new BasketballLeagueError('VALIDATION', message, {
    formErrors: [],
    fieldErrors: { [path]: [message] },
  });
}

export function toValidationError(error: z.ZodError): BasketballLeagueError {
  const details: BasketballFieldErrors = { formErrors: [], fieldErrors: {} };
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (!path) details.formErrors.push(issue.message);
    else (details.fieldErrors[path] ??= []).push(issue.message);
  }
  return new BasketballLeagueError('VALIDATION', 'Check the highlighted fields', details);
}

export interface BasketballErrorResponse {
  status: number;
  body: {
    success: false;
    error: { code: BasketballLeagueErrorCode; message: string; details?: BasketballFieldErrors };
  };
}

export function toBasketballErrorResponse(error: unknown): BasketballErrorResponse {
  const known =
    error instanceof BasketballLeagueError
      ? error
      : error instanceof Prisma.PrismaClientKnownRequestError &&
          CONCURRENT_CHANGE_CODES.has(error.code)
        ? new BasketballLeagueError(
            'CONFLICT',
            'Another change to this league landed at the same time. Reload and try again.'
          )
        : new BasketballLeagueError('INTERNAL', 'Basketball leagues are temporarily unavailable');

  return {
    status: known.status,
    body: {
      success: false,
      error: {
        code: known.code,
        message: known.message,
        ...(known.details ? { details: known.details } : {}),
      },
    },
  };
}
