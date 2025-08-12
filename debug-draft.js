import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugDraft() {
  try {
    console.log('🔍 Checking existing drafts...');
    
    const drafts = await prisma.draft.findMany({
      include: {
        league: {
          include: {
            settings: true
          }
        }
      }
    });
    
    console.log(`Found ${drafts.length} drafts:`);
    
    for (const draft of drafts) {
      console.log(`\n📋 Draft ID: ${draft.id}`);
      console.log(`   League ID: ${draft.leagueId}`);
      console.log(`   League exists: ${!!draft.league}`);
      console.log(`   Settings exist: ${draft.league?.settingsId ? 'Yes' : 'No'}`);
      
      if (draft.league) {
        console.log(`   League name: ${draft.league.name}`);
        console.log(`   Settings ID: ${draft.league.settingsId}`);
        console.log(`   Settings loaded: ${!!draft.league.settings}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugDraft();
