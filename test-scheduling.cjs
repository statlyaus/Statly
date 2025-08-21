// Simple test script to verify the scheduling system

const { 
  generateCompleteSchedule,
  validateLeagueSettings,
  previewScheduleRequirements,
  LEAGUE_PRESETS,
} = require('./src/lib/scheduling/index.js');

console.log('🏈 Testing AFL Fantasy League Scheduling System\n');

// Test 1: Basic 8-team league
console.log('📋 Test 1: Basic 8-team league');
const basicSettings = {
  numTeams: 8,
  seasonWeeks: 16,
  matchupsPerOpponent: 2,
  playoffs: {
    enabled: true,
    teams: 4,
    legLengthWeeks: 1,
    reseedEachRound: false,
    includeConsolation: false,
  }
};

const validation = validateLeagueSettings(basicSettings);
console.log('Validation:', validation.isValid ? '✅ Valid' : '❌ Invalid');
if (!validation.isValid) {
  console.log('Errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.log('Warnings:', validation.warnings);
}

const preview = previewScheduleRequirements(basicSettings);
console.log('Schedule Preview:');
console.log(`- Total weeks needed: ${preview.totalWeeks}`);
console.log(`- Fits in season: ${preview.fitsInSeason ? '✅' : '❌'}`);
console.log(`- Weeks remaining: ${preview.weeksRemaining}`);

if (validation.isValid) {
  const schedule = generateCompleteSchedule(basicSettings);
  console.log('Schedule Generation:', schedule.success ? '✅ Success' : '❌ Failed');
  if (schedule.success) {
    console.log(`- Regular season weeks: ${schedule.summary.regularSeasonWeeks}`);
    console.log(`- Playoff weeks: ${schedule.summary.playoffWeeks}`);
    console.log(`- Total matches: ${schedule.summary.totalMatches}`);
  } else {
    console.log('Error:', schedule.error);
  }
}

console.log('\n📋 Test 2: League Presets');
Object.entries(LEAGUE_PRESETS).forEach(([key, preset]) => {
  console.log(`\n${preset.name}:`);
  const presetValidation = validateLeagueSettings(preset.settings);
  const presetPreview = previewScheduleRequirements(preset.settings);
  console.log(`- Teams: ${preset.settings.numTeams}`);
  console.log(`- Season weeks: ${preset.settings.seasonWeeks}`);
  console.log(`- Playoff teams: ${preset.settings.playoffs?.teams || 0}`);
  console.log(`- Valid: ${presetValidation.isValid ? '✅' : '❌'}`);
  console.log(`- Fits: ${presetPreview.fitsInSeason ? '✅' : '❌'}`);
});

console.log('\n🎯 Test 3: Edge Cases');

// Test with odd number of teams
const oddTeamsSettings = {
  numTeams: 9,
  seasonWeeks: 12,
  matchupsPerOpponent: 1,
  playoffs: {
    enabled: true,
    teams: 4,
    legLengthWeeks: 1,
    reseedEachRound: true,
    includeConsolation: false,
  }
};

console.log('\nOdd teams (9 teams):');
const oddValidation = validateLeagueSettings(oddTeamsSettings);
console.log('Validation:', oddValidation.isValid ? '✅ Valid' : '❌ Invalid');
if (oddValidation.isValid) {
  const oddSchedule = generateCompleteSchedule(oddTeamsSettings);
  console.log('Generation:', oddSchedule.success ? '✅ Success' : '❌ Failed');
  if (oddSchedule.success) {
    console.log(`- Regular season has bye weeks for odd teams`);
    console.log(`- Total weeks: ${oddSchedule.summary.totalWeeks}`);
  }
}

console.log('\n✅ All tests completed!');
