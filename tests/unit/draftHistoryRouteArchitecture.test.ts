import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('draft history route architecture', () => {
  it('uses the shared authenticated user boundary instead of Firebase-only session auth', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/drafts/history/route.ts'),
      'utf8'
    );

    expect(source).toContain("import type { NextRequest } from 'next/server'");
    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain('export async function GET(request: NextRequest)');
    expect(source).toContain('const authenticatedUserId = await getAuthenticatedUserId(request);');
    expect(source).toContain('userId = authenticatedUserId;');
    expect(source).not.toContain("import { cookies } from 'next/headers'");
    expect(source).not.toContain("import { adminAuth } from '@/lib/firebaseAdmin'");
    expect(source).not.toContain("cookieStore.get('statly_session')");
    expect(source).not.toContain('verifySessionCookie');
  });

  it('keeps draft history API routes as adapters over the shared read model', () => {
    const summaryRoute = readFileSync(
      join(process.cwd(), 'src/app/api/drafts/history/route.ts'),
      'utf8'
    );
    const detailRoute = readFileSync(
      join(process.cwd(), 'src/app/api/drafts/history/[id]/route.ts'),
      'utf8'
    );

    expect(summaryRoute).toContain('getDraftHistoryList(prisma, userId');
    expect(summaryRoute).toContain('parseDraftHistoryLimit');
    expect(summaryRoute).not.toContain('prisma.draft.findMany');
    expect(detailRoute).toContain('getDraftHistoryDetail(prisma, userId, draftId)');
    expect(detailRoute).toContain("errorResponse('Draft history not found', 404)");
    expect(detailRoute).toContain('z.string().cuid()');
  });

  it('exposes real archive and detail UI instead of preview-only roster cards', () => {
    const summaryPage = readFileSync(
      join(process.cwd(), 'src/app/(app)/drafts/history/page.tsx'),
      'utf8'
    );
    const detailPage = readFileSync(
      join(process.cwd(), 'src/app/(app)/drafts/history/[id]/page.tsx'),
      'utf8'
    );

    expect(summaryPage).toContain('Open full history');
    expect(summaryPage).toContain('Search leagues, teams, managers, or players');
    expect(summaryPage).not.toContain('.slice(0, 8)');
    expect(detailPage).toContain("type DetailTab = 'rounds' | 'rosters' | 'timeline'");
    expect(detailPage).toContain('Round {round.round}');
    expect(detailPage).toContain('Pick timeline');
  });
});
