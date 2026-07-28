import 'server-only';

import { NextResponse } from 'next/server';

import { createErrorResponse, type ApiErrorResponse } from '@/lib/apiResponse';

export function isDevelopmentToolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.STATLY_ENABLE_DEV_TOOLS === 'true';
}

export function developmentToolsNotFoundResponse(): NextResponse<ApiErrorResponse> {
  return NextResponse.json(createErrorResponse('Not Found', 'NOT_FOUND'), { status: 404 });
}
