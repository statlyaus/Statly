#!/usr/bin/env node

/**
 * Reset Draft After Player Cleanup
 * Resets the current draft to pick 1 after cleaning duplicate players
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRAFT_ID = 'cmeilycnf00047guexen9tq47';

async function resetDraftAfterCleanup() {
  console.log('🔄 Resetting draft after player cleanup...');

  try {
    // Delete all existing picks
    const deletedPicks = await prisma.pick.deleteMany({
      where: { draftId: DRAFT_ID },
    });

    console.log(`🗑️  Deleted ${deletedPicks.count} existing picks`);

    // Reset draft to initial state
    const updatedDraft = await prisma.draft.update({
      where: { id: DRAFT_ID },
      data: {
        currentPick: 1,
        round: 1,
        direction: 'FORWARD',
        status: 'LIVE',
      },
    });

    console.log('✅ Draft reset successfully');
    console.log(`📊 Current pick: ${updatedDraft.currentPick}`);
    console.log(`🔄 Round: ${updatedDraft.round}`);
    console.log(`➡️  Direction: ${updatedDraft.direction}`);
    console.log(`🟢 Status: ${updatedDraft.status}`);

    console.log('\n🎉 Draft ready for clean restart!');
  } catch (error) {
    console.error('❌ Failed to reset draft:', error);
    throw error;
  }
}

resetDraftAfterCleanup()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
