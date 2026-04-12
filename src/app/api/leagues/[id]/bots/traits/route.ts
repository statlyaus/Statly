import type { NextRequest } from 'next/server';

import { BotPersonality } from '@prisma/client';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { botManagerService } from '@/services/botManagerService';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1),
});

const profileSchema = z.object({
  memberId: z.string().min(1),
  personality: z.nativeEnum(BotPersonality).optional(),
  enabled: z.boolean().optional(),
  allowTradeInitiation: z.boolean().optional(),
  allowTradeResponses: z.boolean().optional(),
  allowWaiverClaims: z.boolean().optional(),
  activityLevel: z.number().int().min(0).max(100).optional(),
  tradeAggression: z.number().int().min(0).max(100).optional(),
  tradeRiskTolerance: z.number().int().min(0).max(100).optional(),
  waiverAggression: z.number().int().min(0).max(100).optional(),
  preferredTradeCount: z.number().int().min(1).max(3).optional(),
  minimumActionIntervalMins: z.number().int().min(5).max(10080).optional(),
});

const bodySchema = z.object({
  profiles: z.array(profileSchema).min(1),
});

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const [code, detail] = message.includes(':') ? message.split(/:(.+)/, 2) : [null, message];

  switch (code) {
    case 'forbidden':
      return commonErrors.forbidden(detail);
    case 'bad_request':
      return commonErrors.badRequest(detail);
    default:
      return commonErrors.internalServerError('Failed to manage bot traits');
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized();
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return commonErrors.badRequest('League ID is required');
  }

  try {
    const data = await botManagerService.listProfiles({
      leagueId: parsedParams.data.id,
      actorUserId,
    });
    return successResponse({ members: data });
  } catch (error) {
    return mapError(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized();
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return commonErrors.badRequest('League ID is required');
  }

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return commonErrors.badRequest('Invalid bot trait payload', {
      errors: parsedBody.error.flatten().fieldErrors,
    });
  }

  try {
    const profiles = await botManagerService.upsertProfiles({
      leagueId: parsedParams.data.id,
      actorUserId,
      profiles: parsedBody.data.profiles,
    });
    return successResponse({ profiles });
  } catch (error) {
    return mapError(error);
  }
}
