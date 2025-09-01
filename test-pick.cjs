const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testMakePick() {
  try {
    const draftId = 'cmeilycnf00047guexen9tq47';
    const playerId = 'archie_perkins'; // Another available player
    const memberId = 'cmeilycnh00077gue7snq8u0g';

    console.log('🔍 Testing direct pick creation...');

    // First, check the current draft state
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: true,
          },
        },
        orders: {
          orderBy: { slot: 'asc' },
        },
        picks: {
          orderBy: { overall: 'asc' },
        },
      },
    });

    if (!draft) {
      console.log('❌ Draft not found');
      return;
    }

    console.log('📊 Current draft state:');
    console.log(`  Status: ${draft.status}`);
    console.log(`  Current pick: ${draft.currentPick}`);
    console.log(`  Total orders: ${draft.orders.length}`);
    console.log(`  Existing picks: ${draft.picks.length}`);

    // Calculate snake logic for current pick
    const teamCount = draft.league.members.length;
    const round = Math.ceil(draft.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

    let slot;
    if (direction === 'FORWARD') {
      slot = ((draft.currentPick - 1) % teamCount) + 1;
    } else {
      slot = teamCount - ((draft.currentPick - 1) % teamCount);
    }

    console.log(`📍 Expected turn: Round ${round}, Slot ${slot}, Direction ${direction}`);

    // Find the member who should be picking
    const draftOrder = draft.orders.find((order) => order.slot === slot);
    if (!draftOrder) {
      console.log('❌ No draft order found for slot', slot);
      return;
    }

    console.log(`👤 Current turn member ID: ${draftOrder.memberId}`);
    console.log(`🎯 Attempting pick for member ID: ${memberId}`);

    if (draftOrder.memberId !== memberId) {
      console.log("❌ Not the correct member's turn");
      console.log(`   Expected: ${draftOrder.memberId}`);
      console.log(`   Provided: ${memberId}`);
      return;
    }

    // Check if player exists
    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      console.log('❌ Player not found:', playerId);
      return;
    }

    console.log(`🏈 Player found: ${player.name}`);

    // Check if player is already picked
    const existingPick = draft.picks.find((pick) => pick.playerId === playerId);
    if (existingPick) {
      console.log('❌ Player already picked');
      return;
    }

    console.log('✅ All validations passed. Making pick...');

    // Make the pick using a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the pick
      const pick = await tx.pick.create({
        data: {
          draftId,
          overall: draft.currentPick,
          round,
          slot,
          memberId,
          playerId,
          auto: false,
        },
        include: {
          player: true,
          member: {
            include: {
              user: true,
            },
          },
        },
      });

      console.log('✅ Pick created successfully');

      // Update draft state
      const nextPick = draft.currentPick + 1;
      const rosterSize = draft.league.settings.rosterSize + draft.league.settings.benchSize;
      const totalPicks = teamCount * rosterSize;
      const isComplete = nextPick > totalPicks;

      let updateData = {
        currentPick: nextPick,
      };

      if (isComplete) {
        updateData.status = 'COMPLETED';
        updateData.completedAt = new Date();
      } else {
        // Calculate next round/direction
        const nextRound = Math.ceil(nextPick / teamCount);
        const nextDirection = nextRound % 2 === 1 ? 'FORWARD' : 'REVERSE';
        updateData.round = nextRound;
        updateData.direction = nextDirection;
      }

      await tx.draft.update({
        where: { id: draftId },
        data: updateData,
      });

      console.log('✅ Draft state updated');

      return { pick, isComplete, nextPick };
    });

    console.log('🎉 Pick completed successfully!');
    console.log(`   Player: ${result.pick.player.name}`);
    console.log(`   Pick #: ${result.pick.overall}`);
    console.log(`   Next pick: ${result.nextPick}`);
    console.log(`   Draft complete: ${result.isComplete}`);
  } catch (error) {
    console.error('❌ Error making pick:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testMakePick();
