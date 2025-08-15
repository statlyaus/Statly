import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    console.log('🔍 Checking actual database content...');

    // Check leagues directly
    const leagues = await prisma.league.findMany();
    console.log(`\n📋 Found ${leagues.length} leagues:`);
    leagues.forEach((league) => {
      console.log(`   ${league.id}: ${league.name} (settingsId: ${league.settingsId})`);
    });

    // Check settings directly
    const settings = await prisma.leagueSettings.findMany();
    console.log(`\n⚙️ Found ${settings.length} settings:`);
    settings.forEach((setting) => {
      console.log(`   ${setting.id}: roster=${setting.rosterSize}, maxTeams=${setting.maxTeams}`);
    });

    // Try to find one specific draft with manual join
    const specificDraft = await prisma.draft.findFirst({
      where: { id: 'cme8sovsa001x7gpux2bl1n06' },
    });

    if (specificDraft) {
      console.log(`\n🎯 Specific draft: ${specificDraft.id}`);
      console.log(`   League ID: ${specificDraft.leagueId}`);

      const specificLeague = await prisma.league.findUnique({
        where: { id: specificDraft.leagueId },
      });

      console.log(`   League found: ${!!specificLeague}`);
      if (specificLeague) {
        console.log(`   League name: ${specificLeague.name}`);
        console.log(`   Settings ID: ${specificLeague.settingsId}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();
