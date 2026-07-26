import { prisma } from '@/lib/prisma';

type CountProbe =
  | { ready: true; count: number }
  | { ready: false; count: null; error: string };

type LobbyDraft = {
  id: string;
  status: string;
  lobbyStatus: string | null;
  lobbyOpenAt: Date | null;
} | null;

type LobbyProbe =
  | { success: true; draft: LobbyDraft }
  | { success: false; error: string };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function countProbe(result: PromiseSettledResult<number>): CountProbe {
  return result.status === 'fulfilled'
    ? { ready: true, count: result.value }
    : { ready: false, count: null, error: errorMessage(result.reason) };
}

function lobbyProbe(result: PromiseSettledResult<LobbyDraft>): LobbyProbe {
  return result.status === 'fulfilled'
    ? { success: true, draft: result.value }
    : { success: false, error: errorMessage(result.reason) };
}

/** Read schema readiness without creating or altering database objects. */
export async function loadLobbySchemaDiagnostic() {
  const [draftResult, rosterResult, actionResult, rosterPlayerResult, lobbyResult] =
    await Promise.allSettled([
      prisma.draft.count(),
      prisma.leagueRoster.count(),
      prisma.teamAction.count(),
      prisma.leagueRosterPlayer.count(),
      prisma.draft.findFirst({
        select: {
          id: true,
          status: true,
          lobbyStatus: true,
          lobbyOpenAt: true,
        },
      }),
    ]);

  const tableChecks = {
    draft: countProbe(draftResult),
    leagueRoster: countProbe(rosterResult),
    teamAction: countProbe(actionResult),
    leagueRosterPlayer: countProbe(rosterPlayerResult),
  };
  const lobbyTest = lobbyProbe(lobbyResult);

  return {
    columnsReady: lobbyTest.success,
    tablesReady:
      tableChecks.leagueRoster.ready &&
      tableChecks.teamAction.ready &&
      tableChecks.leagueRosterPlayer.ready,
    draftCount: tableChecks.draft.count,
    tableChecks,
    lobbyTest,
    timestamp: new Date().toISOString(),
  };
}
