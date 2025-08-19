import { logProgress } from './utils';

function calculateSnakeLogic(currentPick: number, teamCount: number) {
  const round = Math.ceil(currentPick / teamCount);
  const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

  let slot: number;
  if (direction === 'FORWARD') {
    slot = ((currentPick - 1) % teamCount) + 1;
  } else {
    slot = teamCount - ((currentPick - 1) % teamCount);
  }

  return { round, direction, slot };
}

function testSnakeLogic() {
  const teamCount = parseInt(process.argv[2]) || 4;
  const rounds = parseInt(process.argv[3]) || 3;
  const totalPicks = teamCount * rounds;

  logProgress(`Testing Snake Draft Logic (${teamCount} teams, ${rounds} rounds):`, 'info');
  console.log('Pick | Round | Direction | Slot | Team');
  console.log('-----|-------|-----------|------|-----');

  for (let pick = 1; pick <= totalPicks; pick++) {
    const result = calculateSnakeLogic(pick, teamCount);
    console.log(
      `${pick.toString().padStart(4)} | ${result.round.toString().padStart(5)} | ${result.direction.padEnd(9)} | ${result.slot.toString().padStart(4)} | Team ${result.slot}`
    );
  }

  logProgress('Expected pattern:', 'info');
  console.log('Round 1 (FORWARD):  1→2→3→4');
  console.log('Round 2 (REVERSE):  4→3→2→1');
  console.log('Round 3 (FORWARD):  1→2→3→4');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testSnakeLogic();
}
