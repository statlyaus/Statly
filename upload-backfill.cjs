#!/usr/bin/env node
const admin = require('firebase-admin');
const fs = require('fs');
const readline = require('readline');

// Initialize Firebase using service account file directly
const serviceAccount = require('/workspaces/Statly/secrets/serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();

async function uploadData() {
  const fileStream = fs.createReadStream('./backfill_output.ndjson');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let processed = 0;
  let errors = 0;
  const batchSize = 100;
  let batch = db.batch();
  let batchCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);

      // Generate document ID
      const docId = `${data.season}-R${data.round}-${getTeamAbbr(data.team)}-${getTeamAbbr(data.opposition)}_ply_${data.player_name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')}`;

      // Create the document
      const docRef = db.collection('player_match_stats').doc(docId);
      batch.set(docRef, {
        player_name: data.player_name,
        team: data.team,
        opposition: data.opposition,
        season: data.season,
        round: data.round,
        match_id: data.match_id.toString(),
        raw_row: data,
        last_updated: admin.firestore.Timestamp.now(),
      });

      batchCount++;

      if (batchCount >= batchSize) {
        await batch.commit();
        processed += batchCount;
        console.log(`Processed ${processed} records...`);
        batch = db.batch();
        batchCount = 0;
      }
    } catch (error) {
      errors++;
      console.error('Error processing line:', error.message);
    }
  }

  // Commit remaining batch
  if (batchCount > 0) {
    await batch.commit();
    processed += batchCount;
  }

  console.log(`Upload complete: ${processed} processed, ${errors} errors`);
}

function getTeamAbbr(teamName) {
  const abbr = {
    Adelaide: 'ADE',
    Brisbane: 'BRL',
    'Brisbane Lions': 'BRL',
    Carlton: 'CAR',
    Collingwood: 'COL',
    Essendon: 'ESS',
    Fremantle: 'FRE',
    Geelong: 'GEE',
    'Gold Coast': 'GCS',
    GWS: 'GWS',
    'Greater Western Sydney': 'GWS',
    Hawthorn: 'HAW',
    Melbourne: 'MEL',
    'North Melbourne': 'NTH',
    'Port Adelaide': 'PTA',
    Richmond: 'RIC',
    'St Kilda': 'STK',
    Sydney: 'SYD',
    'West Coast': 'WCE',
    'Western Bulldogs': 'WBD',
  };
  return abbr[teamName] || 'UNK';
}

uploadData().catch(console.error);
