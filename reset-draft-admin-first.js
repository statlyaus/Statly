#!/usr/bin/env node

/**
 * Script to reset draft to start from admin as pick 1
 * and enable auto-draft for CPU teams
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DRAFT_ID = 'cmeilycnf00047guexen9tq47';

async function resetDraftToAdminFirst() {
  try {
    console.log('🔄 Resetting draft to start with admin as pick 1...');

    // Get current draft state
    const draft = await prisma.draft.findUnique({
      where: { id: DRAFT_ID },
      include: {
        picks: {
          orderBy: { overall: 'asc' },
        },
        league: {
          include: {
            members: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!draft) {
      throw new Error('Draft not found');
    }

    console.log(`📊 Current state:`);
    console.log(`   - Current pick: ${draft.currentPick}`);
    console.log(`   - Picks made: ${draft.picks.length}`);
    console.log(`   - Status: ${draft.status}`);

    // Delete all existing picks (start fresh)
    console.log('🗑️  Deleting existing picks...');
    await prisma.pick.deleteMany({
      where: { draftId: DRAFT_ID },
    });

    // Reset draft to pick 1
    console.log('🔧 Resetting currentPick to 1...');
    await prisma.draft.update({
      where: { id: DRAFT_ID },
      data: {
        currentPick: 1,
        status: 'LIVE', // Ensure it's live
      },
    });

    // Verify admin is in slot 1
    const adminMember = draft.league.members.find(
      (m) => m.user.displayName?.includes('Admin') || m.user.email?.includes('admin')
    );

    if (!adminMember) {
      console.log('⚠️  Could not find admin member');
    } else {
      console.log(`✅ Admin found: ${adminMember.user.displayName} (${adminMember.user.email})`);
    }

    // Log the draft order
    console.log('\n📋 Draft order:');
    const members = draft.league.members.sort((a, b) => a.draftOrder - b.draftOrder);
    members.forEach((member, index) => {
      const isAdmin =
        member.user.displayName?.includes('Admin') || member.user.email?.includes('admin');
      const isCPU = member.user.displayName?.includes('CPU');
      const marker = isAdmin ? ' 👤 (Human)' : isCPU ? ' 🤖 (CPU - Auto)' : '';
      console.log(`   ${index + 1}. ${member.user.displayName}${marker}`);
    });

    console.log('\n✅ Draft reset complete!');
    console.log('🎯 Admin can now make pick 1');
    console.log('🤖 CPU teams will auto-draft when their turn comes');
  } catch (error) {
    console.error('❌ Error resetting draft:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  resetDraftToAdminFirst();
}

export { resetDraftToAdminFirst };
