// Test script for enhanced injury return parsing rules
// Run with: node test-parsing-rules.js

function parseReturnTimeframe(returning) {
  if (!returning || returning.trim() === '') {
    return {
      status: 'UNKNOWN',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }

  const normalized = returning.toLowerCase().trim();
  const original = returning.trim();
  
  // Rule: "Test" → status=TEST, ETAs null
  if (normalized === 'test') {
    return {
      status: 'TEST',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Rule: "TBC" → status=TBC
  if (normalized === 'tbc' || normalized === 'to be confirmed') {
    return {
      status: 'TBC',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Rule: "Season" → status=SEASON
  if (normalized === 'season' || normalized.includes('season')) {
    return {
      status: 'SEASON',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Rule: "Protocols" or "Concussion protocols" → status=PROTOCOLS
  if (normalized.includes('protocol') || normalized.includes('concussion')) {
    return {
      status: 'PROTOCOLS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Rule: (\d+)\s*-\s*(\d+)\s*week(s)? → status=WEEKS, min/max accordingly
  const weekRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*weeks?/);
  if (weekRangeMatch) {
    const min = parseInt(weekRangeMatch[1]);
    const max = parseInt(weekRangeMatch[2]);
    const hasNotes = normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');
    
    return {
      status: 'WEEKS',
      eta_weeks_min: min,
      eta_weeks_max: max,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null
    };
  }
  
  // Rule: (\d+)\+\s*weeks → status=WEEKS, eta_weeks_min=n, eta_weeks_max=null
  const weeksPlusMatch = normalized.match(/(\d+)\+\s*weeks?/);
  if (weeksPlusMatch) {
    const weeks = parseInt(weeksPlusMatch[1]);
    return {
      status: 'WEEKS',
      eta_weeks_min: weeks,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null
    };
  }
  
  // Rule: (\d+)\s*week(s)? → status=WEEKS, eta_weeks_min=max(1, n), eta_weeks_max=n
  const weekSingleMatch = normalized.match(/(\d+)\s*weeks?/);
  if (weekSingleMatch) {
    const weeks = parseInt(weekSingleMatch[1]);
    const minWeeks = Math.max(1, weeks);
    const hasNotes = normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');
    
    return {
      status: 'WEEKS',
      eta_weeks_min: minWeeks,
      eta_weeks_max: weeks,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null
    };
  }
  
  // Rule: (\d+)\s*-\s*(\d+)\s*day(s)? → status=DAYS, min/max accordingly
  const dayRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*days?/);
  if (dayRangeMatch) {
    const min = parseInt(dayRangeMatch[1]);
    const max = parseInt(dayRangeMatch[2]);
    const hasNotes = normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');
    
    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: min,
      eta_days_max: max,
      notes: hasNotes ? original : null
    };
  }
  
  // Rule: (\d+)\+\s*days → status=DAYS, eta_days_min=n, eta_days_max=null
  const daysPlusMatch = normalized.match(/(\d+)\+\s*days?/);
  if (daysPlusMatch) {
    const days = parseInt(daysPlusMatch[1]);
    return {
      status: 'DAYS',
      eta_days_min: days,
      eta_days_max: null,
      eta_weeks_min: null,
      eta_weeks_max: null,
      notes: null
    };
  }
  
  // Rule: (\d+)\s*day(s)? → status=DAYS, eta_days_min=max(1, n), eta_days_max=n
  const daySingleMatch = normalized.match(/(\d+)\s*days?/);
  if (daySingleMatch) {
    const days = parseInt(daySingleMatch[1]);
    const minDays = Math.max(1, days);
    const hasNotes = normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');
    
    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: minDays,
      eta_days_max: days,
      notes: hasNotes ? original : null
    };
  }
  
  // Rule: Empty/unknown/missing text → status=UNKNOWN
  // For odd strings (e.g., "1-3 weeks (reassess)") set notes
  return {
    status: 'UNKNOWN',
    eta_weeks_min: null,
    eta_weeks_max: null,
    eta_days_min: null,
    eta_days_max: null,
    notes: original
  };
}

// Test cases covering all parsing rules
const testCases = [
  // Basic status cases
  { input: 'Test', expected: { status: 'TEST', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: 'TBC', expected: { status: 'TBC', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: 'Season', expected: { status: 'SEASON', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: 'Concussion protocols', expected: { status: 'PROTOCOLS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: 'Protocols', expected: { status: 'PROTOCOLS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  
  // Week patterns
  { input: '2 weeks', expected: { status: 'WEEKS', eta_weeks_min: 2, eta_weeks_max: 2, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: '1 week', expected: { status: 'WEEKS', eta_weeks_min: 1, eta_weeks_max: 1, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: '0 weeks', expected: { status: 'WEEKS', eta_weeks_min: 1, eta_weeks_max: 0, eta_days_min: null, eta_days_max: null, notes: null } }, // Tests max(1, n) rule
  { input: '2-4 weeks', expected: { status: 'WEEKS', eta_weeks_min: 2, eta_weeks_max: 4, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: '6+ weeks', expected: { status: 'WEEKS', eta_weeks_min: 6, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: '1-3 weeks (reassess)', expected: { status: 'WEEKS', eta_weeks_min: 1, eta_weeks_max: 3, eta_days_min: null, eta_days_max: null, notes: '1-3 weeks (reassess)' } },
  
  // Day patterns
  { input: '3 days', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 3, eta_days_max: 3, notes: null } },
  { input: '1 day', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 1, eta_days_max: 1, notes: null } },
  { input: '0 days', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 1, eta_days_max: 0, notes: null } }, // Tests max(1, n) rule
  { input: '5-7 days', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 5, eta_days_max: 7, notes: null } },
  { input: '10+ days', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 10, eta_days_max: null, notes: null } },
  { input: '2-5 days (review)', expected: { status: 'DAYS', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: 2, eta_days_max: 5, notes: '2-5 days (review)' } },
  
  // Unknown/edge cases
  { input: '', expected: { status: 'UNKNOWN', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: null } },
  { input: 'Indefinite', expected: { status: 'UNKNOWN', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: 'Indefinite' } },
  { input: 'Unknown timeframe', expected: { status: 'UNKNOWN', eta_weeks_min: null, eta_weeks_max: null, eta_days_min: null, eta_days_max: null, notes: 'Unknown timeframe' } }
];

console.log('🧪 Testing Enhanced Injury Return Parsing Rules\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = parseReturnTimeframe(testCase.input);
  const matches = JSON.stringify(result) === JSON.stringify(testCase.expected);
  
  if (matches) {
    console.log(`✅ Test ${index + 1}: "${testCase.input}" → ${result.status}`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1}: "${testCase.input}"`);
    console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('🎉 All parsing rules implemented correctly!');
} else {
  console.log(`⚠️  ${failed} test(s) need attention.`);
}
