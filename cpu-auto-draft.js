#!/usr/bin/env node

/**
 * CPU Auto-Draft Handler
 * Monitors draft state and auto-picks for CPU teams
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DRAFT_ID = 'cmeilycnf00047guexen9tq47';
const AUTO_PICK_DELAY = 3000; // 3 seconds delay for CPU picks

async function getCurrentTurnInfo() {
  const draft = await prisma.draft.findUnique({
    where: { id: DRAFT_ID },
    include: {
      league: {
        include: {
          members: {
            include: {
              user: true
            },
            orderBy: { draftSlot: 'asc' }
          }
        }
      },
      picks: {
        orderBy: { overall: 'asc' }
      }
    }
  });

  if (!draft) return null;

  const { currentPick, league } = draft;
  const participants = league.members;
  const numParticipants = participants.length;

  // Calculate current turn using snake draft logic
  let currentPlayerIndex;
  const round = Math.ceil(currentPick / numParticipants);
  const positionInRound = ((currentPick - 1) % numParticipants) + 1;

  if (draft.draftType === 'SNAKE' && round % 2 === 0) {
    // Even rounds go in reverse for snake draft
    currentPlayerIndex = numParticipants - positionInRound;
  } else {
    // Forward direction (odd rounds)
    currentPlayerIndex = positionInRound - 1; // Zero-indexed
  }

  const currentPlayer = participants[currentPlayerIndex];
  const isCPU = currentPlayer?.user.displayName?.includes('CPU');

  return {
    draft,
    currentPick,
    currentPlayer,
    isCPU,
    round,
    totalPicks: draft.picks.length
  };
}

async function triggerAutoPick() {
  try {
    console.log('🤖 Triggering auto-pick for CPU team...');
    
    const response = await fetch(`http://localhost:3000/api/drafts/${DRAFT_ID}/auto-pick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Auto-pick successful: ${result.data?.playerName || 'Player picked'}`);
      return true;
    } else {
      console.log(`❌ Auto-pick failed: ${result.error || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Auto-pick error: ${error.message}`);
    return false;
  }
}

async function monitorAndAutoPick() {
  console.log('🔍 Monitoring draft for CPU auto-picks...');
  
  while (true) {
    try {
      const turnInfo = await getCurrentTurnInfo();
      
      if (!turnInfo) {
        console.log('❌ Could not get draft info');
        break;
      }

      const { currentPick, currentPlayer, isCPU, round, totalPicks, draft } = turnInfo;

      if (draft.status !== 'LIVE') {
        console.log(`📊 Draft status: ${draft.status} - stopping monitor`);
        break;
      }

      if (currentPick > 264) { // Total picks for 12 teams x 22 rounds
        console.log('🏁 Draft complete!');
        break;
      }

      console.log(`📊 Pick ${currentPick} (Round ${round}): ${currentPlayer?.user.displayName}`);

      if (isCPU) {
        console.log(`⏰ Waiting ${AUTO_PICK_DELAY/1000}s before auto-picking...`);
        await new Promise(resolve => setTimeout(resolve, AUTO_PICK_DELAY));
        
        const success = await triggerAutoPick();
        if (!success) {
          console.log('❌ Auto-pick failed, retrying in 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
      } else {
        console.log('👤 Human player turn - waiting for manual pick');
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error('❌ Monitor error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log('🚀 Starting CPU Auto-Draft Monitor...');
  monitorAndAutoPick().finally(() => {
    prisma.$disconnect();
  });
}

export { monitorAndAutoPick };
