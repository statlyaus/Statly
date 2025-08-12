// Example usage of the new Prisma data model
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Example functions to demonstrate the data model in action

// Create a new user
export async function createUser(email: string, displayName: string, passwordHash: string) {
  return await prisma.user.create({
    data: {
      email,
      displayName,
      passwordHash,
    },
  });
}

// Create a new league with settings
export async function createLeague(
  name: string, 
  ownerId: string, 
  settings: {
    rosterSize: number;
    benchSize: number;
    maxTeams: number;
    pickSeconds: number;
    draftType: 'SNAKE';
    startAt: Date;
  }
) {
  // Create league settings first
  const leagueSettings = await prisma.leagueSettings.create({
    data: {
      rosterSize: settings.rosterSize,
      benchSize: settings.benchSize,
      maxTeams: settings.maxTeams,
      pickSeconds: settings.pickSeconds,
      allowAutoPick: true,
      draftType: settings.draftType,
      startAt: settings.startAt,
    },
  });

  // Generate unique invite code
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // Create the league
  return await prisma.league.create({
    data: {
      name,
      ownerId,
      inviteCode,
      settingsId: leagueSettings.id,
    },
    include: {
      settings: true,
      members: {
        include: {
          user: true,
        },
      },
    },
  });
}

// Join a league
export async function joinLeague(leagueId: string, userId: string, teamName: string) {
  return await prisma.leagueMember.create({
    data: {
      leagueId,
      userId,
      teamName,
      role: 'MANAGER',
    },
  });
}

// Create a draft for a league
export async function createDraft(leagueId: string, totalPicks: number) {
  return await prisma.draft.create({
    data: {
      leagueId,
      status: 'SCHEDULED',
      totalPicks,
    },
  });
}

// Get all players
export async function getAllPlayers(limit: number = 50) {
  return await prisma.player.findMany({
    where: {
      active: true,
    },
    take: limit,
    orderBy: {
      name: 'asc',
    },
  });
}

// Get league with all related data
export async function getLeagueDetails(leagueId: string) {
  return await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      settings: true,
      members: {
        include: {
          user: true,
        },
      },
      draft: {
        include: {
          picks: {
            include: {
              player: true,
              member: {
                include: {
                  user: true,
                },
              },
            },
          },
          orders: {
            include: {
              member: {
                include: {
                  user: true,
                },
              },
            },
            orderBy: {
              slot: 'asc',
            },
          },
        },
      },
    },
  });
}

// Clean up function
export async function cleanup() {
  await prisma.$disconnect();
}
