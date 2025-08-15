// Test script for snake draft logic
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

// Test with 4 teams, 3 rounds (12 total picks)
console.log('Snake Draft Logic Test (4 teams, 3 rounds):');
console.log('Pick | Round | Direction | Slot | Team');
console.log('-----|-------|-----------|------|-----');

for (let pick = 1; pick <= 12; pick++) {
  const result = calculateSnakeLogic(pick, 4);
  console.log(
    `${pick.toString().padStart(4)} | ${result.round.toString().padStart(5)} | ${result.direction.padEnd(9)} | ${result.slot.toString().padStart(4)} | Team ${result.slot}`
  );
}

console.log('\nExpected pattern:');
console.log('Round 1 (FORWARD):  1→2→3→4');
console.log('Round 2 (REVERSE):  4→3→2→1');
console.log('Round 3 (FORWARD):  1→2→3→4');
