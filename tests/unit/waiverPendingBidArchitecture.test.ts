import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('waiver pending bid aggregate architecture', () => {
  it('keeps pending FAAB reservations in canonical Prisma waiver state', () => {
    const cancelSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/waivers/cancel/route.ts'),
      'utf8'
    );
    const processSource = readFileSync(
      join(process.cwd(), 'src/server/waivers/WaiverProcessingService.ts'),
      'utf8'
    );
    const schemaSource = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const prismaStoreSource = processSource.slice(
      processSource.indexOf('export class PrismaWaiverClaimStore'),
      processSource.indexOf('class FirestoreWaiverClaimStore')
    );

    expect(schemaSource).toContain('model WaiverPriority');
    expect(prismaStoreSource).toContain('private async reservePendingBid');
    expect(prismaStoreSource).toContain('private async releasePendingBid');
    expect(prismaStoreSource).toContain('UPDATE WaiverPriority');
    expect(prismaStoreSource).toContain('SET pendingBidTotal = CASE');
    expect(cancelSource).toContain('cancelPendingClaim');
    expect(cancelSource).not.toContain('FieldValue.increment(-bid)');
    expect(prismaStoreSource).not.toContain('pendingBidTotalCents');
  });
});
