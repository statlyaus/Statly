const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugDraftState() {
  try {
    const draftId = 'cmeilycnf00047guexen9tq47';

    console.log('🔍 Debugging draft state...');

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        orders: {
          include: {
            member: true,
          },
        },
        picks: {
          include: {
            player: true,
            member: true,
          },
        },
      },
    });

    if (!draft) {
      console.log('❌ Draft not found');
      return;
    }

    console.log('\n📊 Draft Status:', draft.status);
    console.log('📊 Current Pick:', draft.currentPick);
    console.log('📊 Total Picks:', draft.totalPicks);

    console.log('\n👥 Draft Order:');
    draft.orders.forEach((order, index) => {
      console.log(
        `  ${index + 1}. Slot ${order.slot}: ${order.member.displayName} (ID: ${order.member.id}, UserID: ${order.member.userId})`
      );
    });

    // Calculate current turn using snake logic
    const teamCount = draft.orders.length;
    const round = Math.ceil(draft.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

    let slot;
    if (direction === 'FORWARD') {
      slot = ((draft.currentPick - 1) % teamCount) + 1;
    } else {
      slot = teamCount - ((draft.currentPick - 1) % teamCount);
    }

    const currentDrafter = draft.orders.find((order) => order.slot === slot);

    console.log('\n🎯 Current Turn Analysis:');
    console.log(`  Round: ${round}`);
    console.log(`  Direction: ${direction}`);
    console.log(`  Current Slot: ${slot}`);
    console.log(
      `  Current Drafter: ${currentDrafter ? currentDrafter.member.displayName : 'Unknown'} (ID: ${currentDrafter ? currentDrafter.member.id : 'N/A'})`
    );

    console.log('\n🔍 Recent Picks:');
    const recentPicks = draft.picks.slice(-3);
    recentPicks.forEach((pick) => {
      console.log(
        `  Pick #${pick.overall}: ${pick.member.displayName} drafted ${pick.player.name}`
      );
    });

    console.log('\n💡 Debug Info for Frontend:');
    console.log('  - The frontend needs to match the current drafter ID');
    console.log('  - In development mode, it should use the first participant');
    console.log('  - Check browser console for turn detection logs');
    console.log(`  - Current environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  - First drafter ID: ${draft.orders[0]?.member.id}`);
    console.log(`  - First drafter UserID: ${draft.orders[0]?.member.userId}`);
  } catch (error) {
    console.error('❌ Error debugging draft state:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugDraftState();
