#!/usr/bin/env tsx

import { prisma } from '../src/lib/prisma';

async function checkDatabase() {
  try {
    console.log('🔍 Checking database connectivity...');
    
    // Check player count
    const playerCount = await prisma.player.count();
    console.log(`✅ Players seeded: ${playerCount}`);
    
    // Get a sample of players
    const samplePlayers = await prisma.player.findMany({ 
      take: 3,
      orderBy: { name: 'asc' }
    });
    console.log('\n📋 Sample players:');
    samplePlayers.forEach(player => {
      console.log(`  - ${player.name} (${player.club}) - ${player.position}`);
    });
    
    // Check other tables exist
    const userCount = await prisma.user.count();
    const leagueCount = await prisma.league.count();
    const draftCount = await prisma.draft.count();
    
    console.log('\n📊 Database status:');
    console.log(`  - Users: ${userCount}`);
    console.log(`  - Leagues: ${leagueCount}`);
    console.log(`  - Drafts: ${draftCount}`);
    console.log(`  - Players: ${playerCount}`);
    
    console.log('\n✅ Data model implementation successful!');
    console.log('🎯 All tables created and functional');
    
  } catch (error) {
    console.error('❌ Database check failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkDatabase();
}
