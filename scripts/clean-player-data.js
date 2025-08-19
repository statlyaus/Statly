#!/usr/bin/env node

/**
 * Clean Player Data Script
 * Removes duplicate players with arrow symbols from the source data
 */

import fs from 'fs/promises';
import path from 'path';

async function cleanPlayerData() {
  console.log('🧹 Starting player data cleanup...');
  
  // Read the original data
  const filePath = path.join(process.cwd(), 'player_stats_2025.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  
  console.log(`📊 Original entries: ${data.length}`);
  
  // Track player name variations
  const playerVariations = new Map();
  const cleanedData = [];
  
  for (const entry of data) {
    const originalName = entry.Player;
    // Remove arrow symbols and extra spaces
    const cleanName = originalName.replace(/\s*[↗↙]\s*/g, '').trim();
    
    // Track variations for reporting
    if (!playerVariations.has(cleanName)) {
      playerVariations.set(cleanName, new Set());
    }
    playerVariations.get(cleanName).add(originalName);
    
    // Create cleaned entry
    const cleanedEntry = {
      ...entry,
      Player: cleanName
    };
    
    cleanedData.push(cleanedEntry);
  }
  
  console.log(`🔍 Found ${playerVariations.size} unique players`);
  
  // Report duplicates
  console.log('\n📋 Players with duplicates:');
  let duplicateCount = 0;
  for (const [cleanName, variations] of playerVariations) {
    if (variations.size > 1) {
      duplicateCount++;
      console.log(`  ${cleanName}:`);
      for (const variation of variations) {
        console.log(`    - "${variation}"`);
      }
    }
  }
  
  console.log(`\n⚠️  Found ${duplicateCount} players with duplicates`);
  console.log(`✅ Cleaned entries: ${cleanedData.length}`);
  
  // Backup original file
  const backupPath = path.join(process.cwd(), 'player_stats_2025.json.backup');
  await fs.promises.copyFile(filePath, backupPath);
  console.log(`💾 Backup created: ${backupPath}`);
  
  // Write cleaned data
  await fs.promises.writeFile(filePath, JSON.stringify(cleanedData, null, 2));
  console.log(`✨ Cleaned data written to: ${filePath}`);
  
  console.log('\n🎉 Player data cleanup completed!');
}

if (require.main === module) {
  cleanPlayerData().catch(console.error);
}

module.exports = { cleanPlayerData };
