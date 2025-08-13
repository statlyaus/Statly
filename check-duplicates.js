import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDuplicates() {
  try {
    // Get all players
    const players = await prisma.player.findMany({
      orderBy: { name: 'asc' }
    });

    console.log(`Total players in database: ${players.length}`);

    // Check for duplicate names
    const nameGroups = {};
    players.forEach(player => {
      if (!nameGroups[player.name]) {
        nameGroups[player.name] = [];
      }
      nameGroups[player.name].push(player);
    });

    const duplicateNames = Object.entries(nameGroups)
      .filter(([name, players]) => players.length > 1)
      .map(([name, players]) => ({ name, count: players.length, ids: players.map(p => p.id) }));

    if (duplicateNames.length > 0) {
      console.log('\n🚨 Duplicate player names found:');
      duplicateNames.forEach(({ name, count, ids }) => {
        console.log(`  - ${name}: ${count} entries (IDs: ${ids.join(', ')})`);
      });
    } else {
      console.log('\n✅ No duplicate player names found');
    }

    // Check for duplicate IDs (shouldn't happen due to primary key)
    const ids = players.map(p => p.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      console.log('\n🚨 Duplicate IDs found (this should not happen)');
    } else {
      console.log('\n✅ All player IDs are unique');
    }

    // Show first 10 players for reference
    console.log('\n📝 First 10 players:');
    players.slice(0, 10).forEach((player, index) => {
      console.log(`  ${index + 1}. ${player.name} (${player.position}, ${player.club}) - ID: ${player.id}`);
    });

  } catch (error) {
    console.error('Error checking duplicates:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDuplicates();
