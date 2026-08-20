import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadExactJsonExportMock } = vi.hoisted(() => ({
  loadExactJsonExportMock: vi.fn(),
}));

vi.mock('@/server/aflTradeIntelligence/development/privateLocalWorkbookReads', () => ({
  privateLocalWorkbookReads: { loadExactJsonExport: loadExactJsonExportMock },
}));

import { GET } from '@/app/api/dev/afl-trade-evaluation/[tradeId]/export/route';

const tradeId = 'trade:carlton-fremantle-gold-coast';

describe('GET /api/dev/afl-trade-evaluation/[tradeId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid trade id before private reads', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/dev/afl-trade-evaluation/bad/export'),
      { params: Promise.resolve({ tradeId: '../bad' }) }
    );

    expect(response.status).toBe(400);
    expect(loadExactJsonExportMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a concealed reader', null],
    [
      'an unavailable generation',
      {
        state: 'unavailable',
        selector: { valuationScopeKey: 'afl-men:2025-trades', tradeId },
        selection: { kind: 'current' },
        document: { kind: 'json_export' },
        reason: 'withdrawn',
      },
    ],
  ])('returns no private bytes for %s', async (_label, result) => {
    loadExactJsonExportMock.mockResolvedValue(result);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/dev/afl-trade-evaluation/${encodeURIComponent(tradeId)}/export`
      ),
      { params: Promise.resolve({ tradeId: encodeURIComponent(tradeId) }) }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('streams the retained JSON bytes unchanged with their generation identities', async () => {
    const bytes = new TextEncoder().encode('{"exact":true,"clubs":3}\n');
    loadExactJsonExportMock.mockResolvedValue({
      state: 'available',
      selector: { valuationScopeKey: 'afl-men:2025-trades', tradeId },
      selection: { kind: 'current' },
      generationId: `local-private-trade-evaluation-generation:${'a'.repeat(64)}`,
      projectionManifestId: `private-evaluation-projection-manifest:${'b'.repeat(64)}`,
      lifecycle: { status: 'active', current: true },
      document: {
        kind: 'json_export',
        artifact: {
          artifactId: `artifact:${'c'.repeat(64)}`,
          mediaType: 'application/json',
          byteLength: bytes.byteLength,
          sha256: 'd'.repeat(64),
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      },
      bytes,
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/dev/afl-trade-evaluation/${encodeURIComponent(tradeId)}/export`
      ),
      { params: Promise.resolve({ tradeId: encodeURIComponent(tradeId) }) }
    );

    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toContain(
      'trade-carlton-fremantle-gold-coast'
    );
    expect(response.headers.get('X-Statly-Generation-Id')).toBe(
      `local-private-trade-evaluation-generation:${'a'.repeat(64)}`
    );
    expect(response.headers.get('X-Statly-Projection-Manifest-Id')).toBe(
      `private-evaluation-projection-manifest:${'b'.repeat(64)}`
    );
  });
});
