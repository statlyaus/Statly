import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('waiver pending bid aggregate architecture', () => {
  it('decrements both dollar and cent pending bid totals when claims leave pending', () => {
    const cancelSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/waivers/cancel/route.ts'),
      'utf8'
    );
    const processSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/waivers/process/route.ts'),
      'utf8'
    );

    const cancelDecrementBlock = cancelSource.slice(
      cancelSource.indexOf('const bid = typeof data.bidAmount'),
      cancelSource.indexOf('      });', cancelSource.indexOf('const bid = typeof data.bidAmount'))
    );
    const processDecrementBlock = processSource.slice(
      processSource.indexOf('const decrementPendingBidTotal'),
      processSource.indexOf(
        '            };',
        processSource.indexOf('const decrementPendingBidTotal')
      )
    );

    for (const block of [cancelDecrementBlock, processDecrementBlock]) {
      expect(block).toContain('pendingBidTotal: FieldValue.increment(-bid)');
      expect(block).toContain('pendingBidTotalCents: FieldValue.increment(-bidCents)');
      expect(block).toContain('Math.round(bid * 100)');
    }
  });
});
