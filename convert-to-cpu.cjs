const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function convertToCpuPlayers() {
  try {
    const draftId = 'cmeisltym00857g8j6e2jqruq';

    // Get the draft and its members
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!draft) {
      console.log('❌ Draft not found');
      return;
    }

    console.log('🔄 Converting members 2-12 to CPU players...');

    // Convert members 2-12 to CPU players (keep first member as human)
    const membersToConvert = draft.league.members.slice(1); // Skip first member

    for (const member of membersToConvert) {
      await prisma.member.update({
        where: { id: member.id },
        data: { isCpu: true },
      });
      console.log(`✅ Converted ${member.user.name || member.id} to CPU player`);
    }

    console.log('\n🎉 Conversion complete!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

convertToCpuPlayers();
