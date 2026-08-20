import { createGovernedPrivateEvaluationWorkspaceForInternalComposition } from '@/server/aflTradeIntelligence/valuation/internal/createGovernedPrivateEvaluationWorkspace';

const selector = {
  valuationScopeKey: 'afl-trade-history:current',
  tradeId: 'trade:three-club:1',
};
const inspectionId = `private-evaluation-inspection:${'a'.repeat(64)}`;
const operationId = `private-evaluation-operation:${'b'.repeat(64)}`;
const generationId = `local-private-trade-evaluation-generation:${'c'.repeat(64)}`;

describe('governed private evaluation recovery contract', () => {
  it('recovers the retained withdrawn generation without accepting a caller target', async () => {
    const execute = vi.fn(async () => ({
      state: 'recovered' as const,
      selector,
      inspectionId,
      operationId,
      generationId,
      head: {
        status: 'active' as const,
        revision: 3,
        generationId,
      },
    }));
    const workspace = createGovernedPrivateEvaluationWorkspaceForInternalComposition({
      inspect: vi.fn(),
      execute,
      read: vi.fn(),
    });
    const command = {
      inspectionId,
      operationId,
      action: { kind: 'recover' as const },
      review: { rationale: 'Restore the last withdrawn authenticated generation.' },
    };

    await expect(workspace.execute(command)).resolves.toMatchObject({
      state: 'recovered',
      generationId,
      head: { status: 'active', revision: 3 },
    });
    expect(execute).toHaveBeenCalledWith(command);

    await expect(
      workspace.execute({
        ...command,
        action: { kind: 'recover', targetGenerationId: generationId },
      } as unknown as typeof command)
    ).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
