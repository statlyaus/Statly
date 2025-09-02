# Script Update Example: cleanPlayerData.ts

## Before (Current Issues):

1. Duplicate Firebase initialization logic (should use utils.ts)
2. Uses console.log instead of logProgress
3. No proper main() pattern
4. No JSDoc documentation
5. Hardcoded collection names

## Recommended Updates:

```typescript
import { initFirestore, logProgress } from './utils';
import { FIREBASE_COLLECTIONS } from './constants';

const db = initFirestore();

/**
 * Cleans player data by normalizing names and removing duplicates
 * @param verbose - Whether to log detailed information
 */
async function cleanPlayers(verbose = false): Promise<void> {
  const snapshot = await db.collection(FIREBASE_COLLECTIONS.PLAYERS).get();
  let updated = 0;
  const updatedDocs: string[] = [];

  for (const doc of snapshot.docs) {
    // ... existing logic with logProgress instead of console.log
  }

  logProgress(`Cleaned ${updated} player documents.`, 'success');
}

/**
 * Main script execution
 */
async function main(): Promise<void> {
  try {
    const verbose = process.argv.includes('--verbose');
    await cleanPlayers(verbose);
  } catch (error) {
    logProgress(
      `Script failed: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
```

## Benefits:

1. ✅ Consistent error handling
2. ✅ Proper logging with logProgress
3. ✅ Shared Firebase initialization
4. ✅ Shared constants usage
5. ✅ JSDoc documentation
6. ✅ Main execution pattern
7. ✅ Better argument parsing
