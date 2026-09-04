import { globSync, readFileSync } from 'node:fs';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createGovernedPrivateEvaluationWorkspaceForInternalComposition } from '@/server/aflTradeIntelligence/valuation/internal/createGovernedPrivateEvaluationWorkspace';

const selector = {
  valuationScopeKey: 'afl-trade-history:current',
  tradeId: 'trade:three-club:1',
};

const inspectionId = `private-evaluation-inspection:${'a'.repeat(64)}`;
const generationId = `local-private-trade-evaluation-generation:${'b'.repeat(64)}`;
const operationId = `private-evaluation-operation:${'d'.repeat(64)}`;
const projectionManifestId = `private-evaluation-projection-manifest:${'e'.repeat(64)}`;

type Workspace = ReturnType<typeof createGovernedPrivateEvaluationWorkspaceForInternalComposition>;

function createWorkspace() {
  const inspect = vi.fn<(request: Parameters<Workspace['inspect']>[0]) => Promise<unknown>>(
    async () => ({
      state: 'unavailable' as const,
      selector,
      inspectionId,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'active' as const, revision: 1, generationId },
      blockers: [
        {
          code: 'model_not_approved' as const,
          message: 'No admitted model run covers this transaction.',
        },
      ],
    })
  );
  const execute = vi.fn<(request: Parameters<Workspace['execute']>[0]) => Promise<unknown>>(
    async () => ({
      state: 'unavailable' as const,
      selector,
      inspectionId,
      operationId,
      blockers: [
        {
          code: 'model_not_approved' as const,
          message: 'No admitted model run covers this transaction.',
        },
      ],
    })
  );
  const read = vi.fn<(request: Parameters<Workspace['read']>[0]) => Promise<unknown>>(
    async (request) => ({
      state: 'unavailable' as const,
      selector,
      selection: request.selection,
      document: request.document,
      reason: 'not_found' as const,
    })
  );

  return {
    workspace: createGovernedPrivateEvaluationWorkspaceForInternalComposition({
      inspect,
      execute,
      read,
    }),
    adapters: { inspect, execute, read },
  };
}

describe('GovernedPrivateEvaluationWorkspace', () => {
  it('exposes only governed inspection, execution, automated staging, and reads', () => {
    const { workspace } = createWorkspace();

    expect(Object.keys(workspace).sort()).toEqual(['execute', 'inspect', 'read', 'stageAutomated']);
  });

  it('keeps the internal composition constructor out of production imports', () => {
    const permitted = new Set([
      'src/server/aflTradeIntelligence/valuation/governedPrivateEvaluationWorkspace.ts',
    ]);
    const offenders = globSync('src/**/*.{ts,tsx}')
      .filter((path) => !path.includes('/valuation/internal/') && !permitted.has(path))
      .filter((path) =>
        readFileSync(path, 'utf8').includes(
          'valuation/internal/createGovernedPrivateEvaluationWorkspace'
        )
      );

    expect(offenders).toEqual([]);
  });

  it('inspects one composite valuation-scope and trade selector', async () => {
    const { workspace, adapters } = createWorkspace();

    await expect(workspace.inspect(selector)).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      inspectionId,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'active', revision: 1, generationId },
      blockers: [{ code: 'model_not_approved' }],
    });
    expect(adapters.inspect).toHaveBeenCalledWith(selector);

    await expect(
      workspace.inspect({
        valuationScopeKey: selector.valuationScopeKey,
        tradeId: '',
      })
    ).rejects.toThrow();

    adapters.inspect.mockResolvedValueOnce({
      state: 'ready',
      selector,
      inspectionId,
      validThrough: '2026-08-19T10:00:00.000Z',
      head: { status: 'active', revision: 0, generationId },
      blockers: [],
    });
    await expect(workspace.inspect(selector)).rejects.toThrow();
  });

  it('executes only a retained inspection and stable operation identifier', async () => {
    const { workspace, adapters } = createWorkspace();
    const command = {
      inspectionId,
      operationId,
      action: { kind: 'construct_and_activate' as const },
      review: {
        rationale: 'Activate the reviewed calculation generation.',
      },
    };

    await expect(workspace.execute(command)).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      inspectionId,
      operationId: command.operationId,
    });
    expect(adapters.execute).toHaveBeenCalledWith(command);

    await expect(
      workspace.execute({
        ...command,
        authority: { publicationEligible: true },
      } as unknown as typeof command)
    ).rejects.toThrow();
    await expect(
      workspace.execute({
        ...command,
        assets: [],
      } as unknown as typeof command)
    ).rejects.toThrow();
    await expect(
      workspace.execute({
        ...command,
        principalId: 'operator:robert',
      } as unknown as typeof command)
    ).rejects.toThrow();
    await expect(
      workspace.execute({
        ...command,
        requestedAt: '2026-08-19T10:00:00.000Z',
      } as unknown as typeof command)
    ).rejects.toThrow();
    await expect(
      workspace.execute({
        ...command,
        grade: 'A+',
      } as unknown as typeof command)
    ).rejects.toThrow();
    expect(adapters.execute).toHaveBeenCalledTimes(1);

    adapters.execute.mockResolvedValueOnce({
      state: 'unavailable',
      selector,
      inspectionId: `private-evaluation-inspection:${'c'.repeat(64)}`,
      operationId: command.operationId,
      blockers: [
        {
          code: 'model_not_approved',
          message: 'No admitted model run covers this transaction.',
        },
      ],
    });
    await expect(workspace.execute(command)).rejects.toThrow('escaped its inspection');
  });

  it('reads only current or one explicit generation and rejects selector escape', async () => {
    const { workspace, adapters } = createWorkspace();

    await expect(
      workspace.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'archive_summary' },
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      selection: { kind: 'current' },
      document: { kind: 'archive_summary' },
    });
    await expect(
      workspace.read({
        selector,
        selection: { kind: 'generation', generationId },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      selection: { kind: 'generation', generationId },
      document: { kind: 'detail' },
    });
    expect(adapters.read).toHaveBeenCalledTimes(2);

    await expect(
      workspace.read({
        selector,
        selection: {
          kind: 'batch',
          batchId: `private-evaluation-batch:${'f'.repeat(64)}`,
        },
        document: { kind: 'detail' },
      } as never)
    ).rejects.toThrow();
    expect(adapters.read).toHaveBeenCalledTimes(2);

    const bytes = new TextEncoder().encode('{"retained":true}\n');
    adapters.read.mockResolvedValueOnce({
      state: 'available',
      selector,
      selection: { kind: 'current' },
      generationId,
      projectionManifestId,
      lifecycle: { status: 'active', current: true },
      document: {
        kind: 'json_export',
        artifact: createAflTradeByteArtifactRef(
          bytes,
          'application/json',
          '2026-08-19T10:00:00.000Z'
        ),
      },
      bytes,
    });
    await expect(
      workspace.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'json_export' },
      })
    ).resolves.toMatchObject({
      state: 'available',
      generationId,
      projectionManifestId,
      lifecycle: { status: 'active', current: true },
      document: { kind: 'json_export' },
    });

    adapters.read.mockResolvedValueOnce({
      state: 'unavailable',
      selector: { ...selector, tradeId: 'trade:escaped' },
      selection: { kind: 'current' },
      document: { kind: 'detail' },
      reason: 'not_found',
    });
    await expect(
      workspace.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).rejects.toThrow('escaped its selector');

    adapters.read.mockResolvedValueOnce({
      state: 'available',
      selector,
      selection: { kind: 'generation', generationId },
      generationId,
      projectionManifestId,
      lifecycle: { status: 'active', current: true },
      document: {
        kind: 'archive_summary',
        artifact: createAflTradeByteArtifactRef(
          bytes,
          'application/json',
          '2026-08-19T10:00:00.000Z'
        ),
      },
      bytes,
    });
    await expect(
      workspace.read({
        selector,
        selection: { kind: 'generation', generationId },
        document: { kind: 'detail' },
      })
    ).rejects.toThrow('escaped its document selection');

    adapters.read.mockResolvedValueOnce({
      state: 'available',
      selector,
      selection: { kind: 'current' },
      generationId,
      projectionManifestId,
      lifecycle: { status: 'active', current: true },
      document: {
        kind: 'json_export',
        artifact: createAflTradeByteArtifactRef(
          bytes,
          'application/json',
          '2026-08-19T10:00:00.000Z'
        ),
      },
      bytes: new TextEncoder().encode('{"retained":false}\n'),
    });
    await expect(
      workspace.read({
        selector,
        selection: { kind: 'current' },
        document: { kind: 'json_export' },
      })
    ).rejects.toThrow('returned unauthenticated bytes');
  });
});
