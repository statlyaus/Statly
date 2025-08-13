import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDuplicates() {
  try {
    // Get all players
    const players = await prisma.player.findMany({
      orderBy: { name: 'asc' }
    });

    console.log(`Total players in database: ${players.length}`);

    // Check for duplicate names (including variations with arrows)
    const nameGroups = {};
    players.forEach(player => {
      // Clean the name by removing arrows and extra spaces
      const cleanName = player.name.replace(/\s*↗\s*$/, '').trim();
      if (!nameGroups[cleanName]) {
        nameGroups[cleanName] = [];
      }
      nameGroups[cleanName].push(player);
    });

    const duplicateNames = Object.entries(nameGroups)
      .filter(([, playerList]) => playerList.length > 1)
      .map(([name, playerList]) => ({ 
        name, 
        count: playerList.length, 
        players: playerList.map(p => ({ id: p.id, fullName: p.name, club: p.club, position: p.position }))
      }));

    if (duplicateNames.length > 0) {
      console.log('\n🚨 Duplicate player names found (after cleaning):');
      duplicateNames.slice(0, 10).forEach(({ name, count, players }) => {
        console.log(`  - ${name}: ${count} entries`);
        players.forEach(p => {
          console.log(`    * "${p.fullName}" (${p.position}, ${p.club}) - ID: ${p.id}`);
        });
        console.log('');
      });
      console.log(`Total duplicates found: ${duplicateNames.length}`);
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
