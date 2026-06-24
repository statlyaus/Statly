import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league waivers page Firestore architecture', () => {
  it('redirects the standalone waiver route into the league waivers tab', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/waivers/page.tsx'),
      'utf8'
    );

    expect(source).toContain("import { redirect } from 'next/navigation'");
    expect(source).toContain('redirect(`/leagues/${leagueId}?tab=waivers`);');
    expect(source).not.toContain("adminDb.collection('leagues').doc(leagueId)");
    expect(source).not.toContain('LeagueWaiversContainer');
  });

  it('does not pass server Firestore bootstrap objects into the client container', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/waivers/page.tsx'),
      'utf8'
    );

    expect(source).not.toContain('Object.create(null)');
    expect(source).not.toContain('membersIndex');
  });

  it('does not treat unavailable waiver projections as successful empty data', () => {
    const serviceSource = readFileSync(
      join(process.cwd(), 'src/services/waiverService.ts'),
      'utf8'
    );
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
    const processingServiceSource = readFileSync(
      join(process.cwd(), 'src/server/waivers/WaiverProcessingService.ts'),
      'utf8'
    );

    expect(submitSource).not.toContain(
      'dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined'
    );
    expect(submitSource).not.toContain(
      "bidAmount: typeof validatedBid === 'number' ? validatedBid : undefined"
    );
    expect(submitSource).toContain('PrismaWaiverClaimStore');
    expect(processSource).not.toContain('dropPlayerId: claim.dropPlayerId || undefined');
    expect(processSource).not.toContain('bidAmount: claim.bidAmount || undefined');
    expect(processSource).not.toContain('dropPlayerId: freshData.dropPlayerId || undefined');
    expect(processSource).not.toContain('bidAmount: freshData.bidAmount || undefined');
    expect(processingServiceSource).not.toContain('dropPlayerId: input.claim.dropPlayerId ||');
    expect(processingServiceSource).not.toContain('bidAmount: input.claim.bidAmount ||');
    expect(processingServiceSource).toContain(
      '...(input.claim.dropPlayerId ? { dropPlayerId: input.claim.dropPlayerId } : {})'
    );
    expect(processingServiceSource).toContain(
      "...(typeof input.claim.bidAmount === 'number' ? { bidAmount: input.claim.bidAmount } : {})"
    );
    expect(processingServiceSource).toContain(
      '...(claim.dropPlayerId ? { dropPlayerId: claim.dropPlayerId } : {})'
    );
    expect(processingServiceSource).toContain(
      "...(typeof claim.bidAmount === 'number' ? { bidAmount: claim.bidAmount } : {})"
    );
  });
});
