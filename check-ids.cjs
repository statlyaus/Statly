const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkIds() {
  try {
    const leagues = await prisma.league.findMany({
      select: { id: true, name: true }
    });
    
    console.log('📋 Available leagues:');
    leagues.forEach(league => {
      console.log(`  ${league.name}: ${league.id}`);
    });
    
    const drafts = await prisma.draft.findMany({
      include: { league: true }
    });
    
    console.log('\n🏈 Available drafts:');
    drafts.forEach(draft => {
      console.log(`  ${draft.league.name} Draft (${draft.status}): ${draft.id}`);
      console.log(`    League ID: ${draft.leagueId}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIds();
