import { initializeApp, cert } from "firebase-admin/app";
import { spawn } from "child_process";
import * as fs from "fs";

// Initialize Firebase Admin
const svcKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT as string);
initializeApp({ credential: cert(svcKey) });

type BackfillOptions = {
  startSeason: number;
  endSeason: number;
  startRound?: number;
  endRound?: number;
  delay?: number; // milliseconds between requests
};

async function backfillData(options: BackfillOptions): Promise<void> {
  const { startSeason, endSeason, startRound = 1, endRound = 24, delay = 2000 } = options;

  console.log(`Starting backfill from ${startSeason} to ${endSeason}`);

  for (let season = startSeason; season <= endSeason; season++) {
    console.log(`\n=== Processing Season ${season} ===`);
    
    for (let round = startRound; round <= endRound; round++) {
      console.log(`Processing Season ${season}, Round ${round}...`);
      
      try {
        const outfile = `/tmp/backfill_${season}_${round}.json`;
        const args = ["etl/fetch_fw_round.R", season.toString(), round.toString(), outfile];
        
        // Run R script
        await new Promise<void>((resolve, reject) => {
          const p = spawn("Rscript", args);
          p.on("exit", code => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Rscript failed for ${season}R${round} with code ${code}`));
            }
          });
          p.on("error", reject);
        });

        // Process the output if file exists
        if (fs.existsSync(outfile)) {
          const { runOnce } = await import('./ingestFootywire');
          // Set environment variables for this specific round
          process.env.SEASON = season.toString();
          process.env.ROUND = round.toString();
          process.env.OUTFILE = outfile;
          
          // Import and run the ingestion logic
          await runOnce();
          
          // Clean up temp file
          fs.unlinkSync(outfile);
          console.log(`✓ Completed Season ${season}, Round ${round}`);
        } else {
          console.log(`⚠ No data found for Season ${season}, Round ${round}`);
        }
        
        // Rate limiting delay
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        console.error(`✗ Error processing Season ${season}, Round ${round}:`, error);
        // Continue with next round/season
      }
    }
  }

  console.log(`\n=== Backfill completed ===`);
}

// Command line usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`Usage: node backfill.js <startSeason> <endSeason> [startRound] [endRound] [delay]`);
    console.log(`Example: node backfill.js 2023 2025 1 24 3000`);
    process.exit(1);
  }

  const options: BackfillOptions = {
    startSeason: parseInt(args[0]),
    endSeason: parseInt(args[1]),
    startRound: args[2] ? parseInt(args[2]) : 1,
    endRound: args[3] ? parseInt(args[3]) : 24,
    delay: args[4] ? parseInt(args[4]) : 2000
  };

  backfillData(options).catch(console.error);
}

export { backfillData };
