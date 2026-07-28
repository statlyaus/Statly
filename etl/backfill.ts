import 'dotenv/config';
import { runFetchPipeline } from './fetchPipeline';

type BackfillOptions = {
  startSeason: number;
  endSeason: number;
  startRound?: number;
  endRound?: number;
  delay?: number; // milliseconds between requests
};

async function backfillData(options: BackfillOptions): Promise<void> {
  const { startSeason, endSeason, startRound = 1, endRound = 24, delay = 2000 } = options;
  const failures: string[] = [];

  console.log(`Starting backfill from ${startSeason} to ${endSeason}`);

  for (let season = startSeason; season <= endSeason; season++) {
    console.log(`\n=== Processing Season ${season} ===`);

    for (let round = startRound; round <= endRound; round++) {
      console.log(`Processing Season ${season}, Round ${round}...`);

      try {
        await runFetchPipeline({ season, round, backfillMode: true });
        console.log(`✓ Completed Season ${season}, Round ${round}`);

        // Rate limiting delay
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        console.error(`✗ Error processing Season ${season}, Round ${round}:`, error);
        failures.push(`${season}R${round}`);
        // Continue with next round/season
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Backfill failed for ${failures.length} round(s): ${failures.join(', ')}`);
  }

  console.log(`\n=== Backfill completed successfully ===`);
}

// Command line usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(
      `Usage: node backfill.js <startSeason> <endSeason> [startRound] [endRound] [delay]`
    );
    console.log(`Example: node backfill.js 2023 2025 1 24 3000`);
    process.exit(1);
  }

  const options: BackfillOptions = {
    startSeason: parseInt(args[0]),
    endSeason: parseInt(args[1]),
    startRound: args[2] ? parseInt(args[2]) : 1,
    endRound: args[3] ? parseInt(args[3]) : 24,
    delay: args[4] ? parseInt(args[4]) : 2000,
  };

  backfillData(options).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { backfillData };
