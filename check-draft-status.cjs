const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDraftStatus() {
  try {
    const picks = await prisma.pick.findMany({
      where: { draftId: 'cmeilycnf00047guexen9tq47' },
      include: {
        player: true,
        member: {
          include: { user: true },
        },
      },
      orderBy: { overall: 'asc' },
    });

    console.log('🏈 Players already picked:');
    picks.forEach((pick) => {
      console.log(
        `  Pick ${pick.overall}: ${pick.player.name} (${pick.playerId}) - ${pick.member.user.name}`
      );
    });

    // Get some available players
    const pickedPlayerIds = picks.map((p) => p.playerId);
    const availablePlayers = await prisma.player.findMany({
      where: {
        id: { notIn: pickedPlayerIds },
      },
      take: 10,
    });

    console.log('\n🎯 First 10 available players:');
    availablePlayers.forEach((player) => {
      console.log(`  ${player.name} (${player.id}) - ${player.club}`);
    });
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDraftStatus();
