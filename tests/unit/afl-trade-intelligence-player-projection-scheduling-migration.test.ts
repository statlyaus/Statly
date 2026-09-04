import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0095_draftguru_player_projection_scheduling/migration.sql'
  ),
  'utf8'
);
const targetGuardMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0096_draftguru_player_projection_historical_target/migration.sql'
  ),
  'utf8'
);
const targetConstraintMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0097_draftguru_player_projection_target_constraint/migration.sql'
  ),
  'utf8'
);
const reconciliationAnchorMigration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/afl-trade-outcomes/migrations/0098_historical_reconciliation_observed_anchor/migration.sql'
  ),
  'utf8'
);

describe('Draftguru player-projection scheduling migration', () => {
  it('preserves every existing scheduled capability and admits only the player projection', () => {
    expect(migration).toContain("'draftguru-trade-detail'");
    expect(migration).toContain("'draftguru-player-trade-detail'");
    expect(migration).toContain("'draftguru-year-page'");
    expect(migration).toContain("'footywire-draft-results'");
    expect(migration).toContain("'official-afl-indicative-draft-order'");
  });

  it('requires index discovery evidence for full and player-only trade targets', () => {
    expect(targetGuardMigration).toContain("'draftguru-player-trade-detail'");
    expect(targetGuardMigration).toContain('NEW.discovery_evidence_id IS NOT NULL');
    expect(targetGuardMigration).toContain('Historical target discovery evidence mismatch');
  });

  it('admits the player projection in the retained historical target constraint', () => {
    expect(targetConstraintMigration).toContain(
      "capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page')"
    );
  });

  it('anchors reconciliation to the latest completed target rather than an unused plan year', () => {
    expect(reconciliationAnchorMigration).toContain('max(target.anchor_season_year)');
    expect(reconciliationAnchorMigration).toContain(
      'NEW.anchor_season_year <> completion_anchor_season'
    );
  });
});
