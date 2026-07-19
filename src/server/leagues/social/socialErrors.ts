export type SocialErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'MUTED'
  | 'INTERNAL';

const SOCIAL_ERROR_STATUS: Record<SocialErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  MUTED: 403,
  INTERNAL: 500,
};

export class SocialError extends Error {
  readonly code: SocialErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: SocialErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
    this.status = SOCIAL_ERROR_STATUS[code];
    this.details = details;
  }
}

export function toSocialErrorResponse(error: unknown): {
  status: number;
  body: {
    success: false;
    error: {
      code: SocialErrorCode;
      message: string;
      details?: unknown;
    };
  };
} {
  const socialError =
    error instanceof SocialError
      ? error
      : new SocialError('INTERNAL', 'League social content is temporarily unavailable');

  return {
    status: socialError.status,
    body: {
      success: false,
      error: {
        code: socialError.code,
        message: socialError.message,
        ...(socialError.details === undefined ? {} : { details: socialError.details }),
      },
    },
  };
}
