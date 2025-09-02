const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createImmediateTestDraft() {
  try {
    console.log('🚀 Creating immediate test draft...');

    // Start time: 3 minutes from now (will trigger lobby in ~2 minutes)
    const startTime = new Date(Date.now() + 3 * 60 * 1000);

    // 1. Find an existing league with a draft (easier than creating new ones)
    const existingDraft = await prisma.draft.findFirst({
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!existingDraft) {
      throw new Error('No existing draft found. Please create a league and draft first.');
    }

    console.log('✅ Found existing draft:', existingDraft.id);
    console.log('   League:', existingDraft.league.name);

    // 2. Update the league settings to start soon
    await prisma.leagueSettings.update({
      where: { id: existingDraft.league.settingsId },
      data: {
        startAt: startTime,
        pickSeconds: 60, // 60 seconds per pick
      },
    });

    // 3. Reset the draft to scheduled status
    const updatedDraft = await prisma.draft.update({
      where: { id: existingDraft.id },
      data: {
        status: 'SCHEDULED',
        lobbyStatus: 'CLOSED', // Will auto-open when time comes
        lobbyOpenAt: null,
        currentPick: 1,
        round: 1,
        startedAt: null,
        completedAt: null,
      },
    });

    console.log('✅ Draft updated:');
    console.log('   Draft ID:', updatedDraft.id);
    console.log('   League ID:', existingDraft.leagueId);
    console.log('   Start Time:', startTime.toLocaleString());
    console.log('   Minutes until start:', Math.round((startTime - new Date()) / 60000));

    console.log('\n🎯 Test URLs:');
    console.log(`   Draft Room: http://localhost:3000/drafts/${updatedDraft.id}`);
    console.log(`   API Test: http://localhost:3000/api/drafts/${updatedDraft.id}/lobby`);

    console.log('\n⏰ Timeline:');
    console.log(`   Now: ${new Date().toLocaleString()}`);
    console.log(
      `   Lobby opens: ${new Date(startTime.getTime() - 5 * 60 * 1000).toLocaleString()} (T-5min)`
    );
    console.log(`   Draft starts: ${startTime.toLocaleString()} (T+0min)`);

    return {
      draftId: updatedDraft.id,
      leagueId: existingDraft.leagueId,
      startTime,
    };
  } catch (error) {
    console.error('❌ Error creating test draft:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createImmediateTestDraft()
    .then((result) => {
      console.log(
        '\n🎉 Success! Visit the draft room in ~2 minutes to see the lobby open automatically.'
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { createImmediateTestDraft };
