import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('audited navigation destination contract', () => {
  it('sends Fantasy controls to the canonical workspace', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');

    expect(navigation).toContain("name: 'Fantasy'");
    expect(navigation).toContain("href: '/dashboard'");
    expect(navigation).toContain('href="/dashboard"');
    expect(navigation).not.toContain('/fantasy');
  });

  it('lands the dashboard waiver action at the existing claim workflow', () => {
    const waiversModule = readRepoFile('src/components/dashboard/WaiversModule.tsx');
    const waiverSurface = readRepoFile('src/components/waivers/WaiverFAABSystem.tsx');

    expect(waiversModule).toContain('href="/waivers#waiver-player-search"');
    expect(waiversModule).not.toContain('/waivers/submit');
    expect(waiverSurface).toContain('id="waiver-player-search"');
  });

  it('preserves Team Analytics as the post-login destination', () => {
    const teamAnalyticsPage = readRepoFile('src/app/(app)/team-analytics/page.tsx');

    expect(teamAnalyticsPage).toContain('href="/login?callbackUrl=/team-analytics"');
    expect(teamAnalyticsPage).not.toContain('/auth/signin');
    expect(teamAnalyticsPage).not.toContain('window.location.href');
  });
});
