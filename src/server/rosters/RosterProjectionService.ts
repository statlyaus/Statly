import { prisma } from '@/lib/prisma';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

type PrismaLike = Pick<typeof prisma, 'pick' | 'leagueRoster' | 'leagueRosterPlayer'>;
type WaiverAvailabilityProjectionLike = Pick<WaiverAvailabilityProjectionService, 'projectLeague'>;

export interface RosterProjectionResult {
  projected: number;
}

export class RosterProjectionService {
  constructor(
    private readonly db: PrismaLike = prisma,
    private readonly waiverAvailabilityProjectionService: WaiverAvailabilityProjectionLike = new WaiverAvailabilityProjectionService()
  ) {}

  async projectDraft(input: {
    leagueId: string;
    draftId: string;
  }): Promise<RosterProjectionResult> {
    const picks = await this.db.pick.findMany({
      where: { draftId: input.draftId },
      orderBy: { overall: 'asc' },
      select: { id: true, draftId: true, playerId: true, memberId: true },
    });

    const rosterShells = new Set<string>();

    for (const pick of picks) {
      if (!rosterShells.has(pick.memberId)) {
        await this.db.leagueRoster.upsert({
          where: {
            leagueId_memberId: {
              leagueId: input.leagueId,
              memberId: pick.memberId,
            },
          },
          update: {},
          create: {
            leagueId: input.leagueId,
            memberId: pick.memberId,
            playerIds: '[]',
          },
        });
        rosterShells.add(pick.memberId);
      }

      await this.db.leagueRosterPlayer.upsert({
        where: {
          leagueId_playerId: {
            leagueId: input.leagueId,
            playerId: pick.playerId,
          },
        },
        update: {
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          acquiredBy: 'DRAFT',
        },
        create: {
          leagueId: input.leagueId,
          memberId: pick.memberId,
          draftId: pick.draftId,
          pickId: pick.id,
          playerId: pick.playerId,
          acquiredBy: 'DRAFT',
        },
      });
    }

    await this.waiverAvailabilityProjectionService.projectLeague({ leagueId: input.leagueId });

    return { projected: picks.length };
  }
}
