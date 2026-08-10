import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma'),
  'utf8'
);
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0020_promotion_backed_corpus',
    'migration.sql'
  ),
  'utf8'
);

describe('promotion-backed canonical corpus authority schema', () => {
  it('persists an immutable private corpus and typed exact membership', () => {
    for (const model of [
      'OutcomePromotionBackedCorpus',
      'OutcomePromotionBackedCorpusPromotion',
      'OutcomePromotionBackedCorpusMember',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const table of [
      'outcome_promotion_backed_corpus',
      'outcome_promotion_backed_corpus_promotion',
      'outcome_promotion_backed_corpus_member',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain(
      `"corpus_json"->'content'->>'publicationEligible' IS NOT DISTINCT FROM 'false'`
    );
    expect(migration).toContain('outcome_promotion_backed_corpus_member_record_fkey');
  });

  it('freezes only the complete eligible promotion and record sets', () => {
    expect(migration).toContain('finalize_outcome_promotion_backed_corpus');
    expect(migration).toContain('eligible_promotions EXCEPT SELECT promotion_id FROM members');
    expect(migration).toContain('members EXCEPT SELECT promotion_id FROM eligible_promotions');
    expect(migration).toContain(
      'member_set_canonical_json::jsonb IS DISTINCT FROM actual_member_set'
    );
    expect(migration).toContain('promotion_record_count <> actual_record_count');
    expect(migration).toContain('Canonical corpus evidence is append-only');
  });
});
