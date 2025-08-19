const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSpecificDraft() {
  try {
    const draftId = 'cmeisltym00857g8j6e2jqruq';
    
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: {
              include: { user: true }
            }
          }
        },
        orders: {
          orderBy: { slot: 'asc' },
          include: {
            member: {
              include: { user: true }
            }
          }
        },
        picks: {
          orderBy: { overall: 'asc' },
          include: {
            player: true,
            member: {
              include: { user: true }
            }
          }
        }
      }
    });
    
    if (!draft) {
      console.log('❌ Draft not found:', draftId);
      return;
    }
    
    console.log('📊 Draft Status:');
    console.log(`  ID: ${draft.id}`);
    console.log(`  Status: ${draft.status}`);
    console.log(`  Current Pick: ${draft.currentPick}`);
    console.log(`  League: ${draft.league.name}`);
    console.log(`  League ID: ${draft.leagueId}`);
    
    console.log('\n👥 Draft Order:');
    draft.orders.forEach(order => {
      console.log(`  Slot ${order.slot}: ${order.member.user.name} (${order.member.isCpu ? 'CPU' : 'Human'})`);
    });
    
    console.log('\n🏈 Recent Picks:');
    const recentPicks = draft.picks.slice(-5);
    recentPicks.forEach(pick => {
      console.log(`  Pick ${pick.overall}: ${pick.player.name} - ${pick.member.user.name} (${pick.auto ? 'AUTO' : 'MANUAL'})`);
    });
    
    // Calculate current turn
    const teamCount = draft.league.members.length;
    const round = Math.ceil(draft.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';
    
    let slot;
    if (direction === 'FORWARD') {
      slot = ((draft.currentPick - 1) % teamCount) + 1;
    } else {
      slot = teamCount - ((draft.currentPick - 1) % teamCount);
    }
    
    const currentOrder = draft.orders.find(order => order.slot === slot);
    console.log(`\n🎯 Current Turn (Pick ${draft.currentPick}):`);
    console.log(`  Round ${round} (${direction}), Slot ${slot}`);
    console.log(`  Player: ${currentOrder?.member.user.name} (${currentOrder?.member.isCpu ? 'CPU' : 'Human'})`);
    console.log(`  Member ID: ${currentOrder?.member.id}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSpecificDraft();
