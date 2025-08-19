const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function updateToCpu() {
  try {
    // Update members 2-12 to be CPU players for the league
    const leagueId = 'cmeisltyl00837g8jsgqrc96l';
    
    // Get all members of this league
    const members = await prisma.member.findMany({
      where: { leagueId: leagueId },
      orderBy: { createdAt: 'asc' }
    });
    
    console.log(`Found ${members.length} members`);
    
    // Keep first member as human, make rest CPU
    for (let i = 1; i < members.length; i++) {
      await prisma.member.update({
        where: { id: members[i].id },
        data: { isCpu: true }
      });
      console.log(`✅ Updated member ${i + 1} to CPU`);
    }
    
    console.log('🎉 Successfully updated members to CPU!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateToCpu();
