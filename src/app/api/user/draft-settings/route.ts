export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';

import { z } from 'zod';

import {
  DRAFT_PICK_SECONDS_OPTIONS,
  MAX_DRAFT_PICK_SECONDS,
  MIN_DRAFT_PICK_SECONDS,
} from '@/lib/draftClock';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

const DRAFT_SETTINGS_COOKIE = 'statly_draft_settings';

const pickSecondsSchema = z
  .number()
  .int()
  .refine(
    (value) =>
      DRAFT_PICK_SECONDS_OPTIONS.includes(value as (typeof DRAFT_PICK_SECONDS_OPTIONS)[number]),
    `Pick timer must be one of: ${DRAFT_PICK_SECONDS_OPTIONS.join(', ')} seconds`
  )
  .refine(
    (value) => value >= MIN_DRAFT_PICK_SECONDS && value <= MAX_DRAFT_PICK_SECONDS,
    `Pick timer must be between ${MIN_DRAFT_PICK_SECONDS} and ${MAX_DRAFT_PICK_SECONDS} seconds`
  );

const DraftPreferencesSchema = z.object({
  autoPickEnabled: z.boolean(),
  autoPickTime: pickSecondsSchema,
  notificationsEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  defaultTimePerPick: pickSecondsSchema,
  preferredDraftType: z.enum(['SNAKE', 'LINEAR']),
  timezone: z.string().min(1).max(100),
});

type DraftPreferences = z.infer<typeof DraftPreferencesSchema>;

const DEFAULT_DRAFT_PREFERENCES: DraftPreferences = {
  autoPickEnabled: false,
  autoPickTime: 120,
  notificationsEnabled: true,
  soundEnabled: true,
  defaultTimePerPick: 120,
  preferredDraftType: 'SNAKE',
  timezone: 'Australia/Melbourne',
};

function readPreferencesFromCookie(request: NextRequest): DraftPreferences {
  const raw = request.cookies.get(DRAFT_SETTINGS_COOKIE)?.value;
  if (!raw) return DEFAULT_DRAFT_PREFERENCES;

  try {
    const decoded = JSON.parse(decodeURIComponent(raw)) as unknown;
    const parsed = DraftPreferencesSchema.safeParse(decoded);
    if (!parsed.success) return DEFAULT_DRAFT_PREFERENCES;
    return parsed.data;
  } catch {
    return DEFAULT_DRAFT_PREFERENCES;
  }
}

function createSettingsResponse(
  preferences: DraftPreferences,
  init?: { status?: number }
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data: preferences,
    },
    { status: init?.status ?? 200 }
  );
}

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return createSettingsResponse(readPreferencesFromCookie(request));
}

export async function PUT(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = DraftPreferencesSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid draft settings payload',
        issues: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  const response = createSettingsResponse(parsed.data);
  response.cookies.set(DRAFT_SETTINGS_COOKIE, encodeURIComponent(JSON.stringify(parsed.data)), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
