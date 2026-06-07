import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league waivers page Firestore architecture', () => {
  it('authorizes league membership before Admin SDK league reads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/waivers/page.tsx'),
      'utf8'
    );

    expect(source).toContain("import { requireUser } from '@/lib/requireUser'");
    expect(source).toContain("import { verifyLeagueMembership } from '@/lib/leagueMembership'");
    expect(source).toContain('const userId = await requireUser();');
    expect(source).toContain('const membership = await verifyLeagueMembership(leagueId, userId);');
    expect(source).toContain('if (!membership.isMember)');
    expect(source.indexOf('verifyLeagueMembership(leagueId, userId)')).toBeLessThan(
      source.indexOf("adminDb.collection('leagues').doc(leagueId)")
    );
  });

  it('does not treat unavailable waiver projections as successful empty data', () => {
    const serviceSource = readFileSync(join(process.cwd(), 'src/services/waiverService.ts'), 'utf8');
    const containerSource = readFileSync(
      join(process.cwd(), 'src/components/waivers/LeagueWaiversContainer.tsx'),
      'utf8'
    );

    expect(serviceSource).toContain(
      'Waiver data is unavailable because league ownership projection has not loaded'
    );
    expect(serviceSource).not.toContain('mock');
    expect(serviceSource).not.toContain('stub');
    expect(containerSource).toContain('waiverLoadError');
    expect(containerSource).toContain('role="alert"');
  });

  it('omits optional Firestore fields instead of writing undefined values', () => {
    const submitSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/waivers/submit/route.ts'),
      'utf8'
    );
    const processSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/waivers/process/route.ts'),
      'utf8'
    );

    expect(submitSource).not.toContain(
      'dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined'
    );
    expect(submitSource).not.toContain(
      "bidAmount: typeof validatedBid === 'number' ? validatedBid : undefined"
    );
    expect(submitSource).toContain('const waiverClaimData = {');
    expect(submitSource).toContain(
      '...(dropPlayerId ? { dropPlayerId: String(dropPlayerId) } : {})'
    );
    expect(submitSource).toContain(
      "...(typeof validatedBid === 'number' ? { bidAmount: validatedBid } : {})"
    );
    expect(processSource).not.toContain('dropPlayerId: claim.dropPlayerId || undefined');
    expect(processSource).not.toContain('bidAmount: claim.bidAmount || undefined');
    expect(processSource).not.toContain('dropPlayerId: freshData.dropPlayerId || undefined');
    expect(processSource).not.toContain('bidAmount: freshData.bidAmount || undefined');
    expect(processSource).toContain('const failedActivityData = {');
    expect(processSource).toContain('const successfulActivityData = {');
    expect(processSource).not.toContain('const freshData = freshSnap.data() as WaiverClaimRaw');
    expect(processSource).toContain('id: freshSnap.id,');
  });
});
