#!/usr/bin/env node

/**
 * Script to reset draft currentPick to 1
 * This fixes the issue where Pick 1 was skipped and the draft is stuck
 */

const fetch = require('node-fetch');

const DRAFT_ID = 'cmeilycnf00047guexen9tq47';
const API_BASE = 'http://localhost:3000';

async function resetDraftToPickOne() {
  try {
    console.log('🔍 Checking current draft state...');
    
    // First, get current state
    const response = await fetch(`${API_BASE}/api/drafts/${DRAFT_ID}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error('Failed to fetch draft data');
    }
    
    const { currentPick, picks, status } = data.data;
    console.log(`Current Pick: ${currentPick}`);
    console.log(`Picks Made: ${picks?.length || 0}`);
    console.log(`Status: ${status}`);
    
    if (currentPick === 1) {
      console.log('✅ Draft is already at pick 1');
      return;
    }
    
    if (picks && picks.length > 1) {
      console.log('⚠️  Multiple picks already made. This reset may cause issues.');
      console.log('Picks made:');
      picks.forEach(pick => {
        console.log(`  - Pick ${pick.overall}: ${pick.player?.name} (Slot ${pick.slot})`);
      });
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('Continue anyway? (y/N): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== 'y') {
        console.log('❌ Reset cancelled');
        return;
      }
    }
    
    // We need to make a direct database update since there's no API endpoint for this
    // Let's use the Node.js script approach
    console.log('🔧 Resetting currentPick to 1...');
    
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    await prisma.draft.update({
      where: { id: DRAFT_ID },
      data: { currentPick: 1 }
    });
    
    await prisma.$disconnect();
    
    console.log('✅ Successfully reset currentPick to 1');
    console.log('🎯 CPU Team 1 can now make their pick');
    
    // Verify the change
    const verifyResponse = await fetch(`${API_BASE}/api/drafts/${DRAFT_ID}`);
    const verifyData = await verifyResponse.json();
    console.log(`✅ Verified: currentPick is now ${verifyData.data.currentPick}`);
    
  } catch (error) {
    console.error('❌ Error resetting draft:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  resetDraftToPickOne();
}

module.exports = { resetDraftToPickOne };
