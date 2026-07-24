import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('pre-draft queue authorization', () => {
  it('derives pre-queue member identity from authenticated draft membership', () => {
    const source = read('src/app/api/drafts/[id]/pre-queue/route.ts');

    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('getDraftMembershipAccess');
    expect(source).toContain('access.memberId');
    expect(source).not.toContain("searchParams.get('memberId')");
    expect(source).not.toContain('body.memberId');
  });

  it('keeps the compatibility queue route on PreDraftQueue and server-derived membership', () => {
    const source = read('src/app/api/drafts/[id]/queue/route.ts');

    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('getDraftMembershipAccess');
    expect(source).toContain('access.memberId');
    expect(source).toContain('preDraftQueue');
    expect(source).toContain('resolveCanonicalPlayerId');
    expect(source).toContain('resolveCanonicalPlayerIds');
    expect(source).not.toMatch(/\\bqueueItem\\b/i);
    expect(source).not.toContain('memberId: z.string().min(1)');
  });

  it('auto-pick reaches PreDraftQueue through the draft service and repository', () => {
    const routeSource = read('src/app/api/drafts/[id]/auto-pick/route.ts');
    const repositorySource = read('src/server/draft/repository/DraftRepository.ts');

    expect(routeSource).toContain('draftApplicationService.autoPick');
    expect(repositorySource).toContain('tx.preDraftQueue.findFirst');
    expect(repositorySource).toContain('tx.preDraftQueue.deleteMany');
    expect(repositorySource).toContain('tx.preDraftQueue.delete');
    expect(repositorySource).not.toContain('tx.queueItem');
  });
});
