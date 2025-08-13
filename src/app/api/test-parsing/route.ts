// Enhanced parsing rules test endpoint
// Add this to demonstrate the parsing capabilities

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const testCases = [
    { input: 'Test', description: 'Player being tested for availability' },
    { input: 'TBC', description: 'Return timeframe to be confirmed' },
    { input: 'Season', description: 'Season-ending injury' },
    { input: 'Concussion protocols', description: 'Health and safety protocols' },
    { input: '2 weeks', description: 'Fixed 2-week timeframe' },
    { input: '1-3 weeks', description: 'Range timeframe' },
    { input: '6+ weeks', description: 'Minimum timeframe (open-ended)' },
    { input: '5 days', description: 'Fixed day timeframe' },
    { input: '3-7 days', description: 'Day range' },
    { input: '10+ days', description: 'Minimum days (open-ended)' },
    { input: '2-4 weeks (reassess)', description: 'Range with notes' },
    { input: 'Indefinite', description: 'Unknown/unclear timeframe' }
  ];

  const results = testCases.map(testCase => {
    const parsed = parseReturnTimeframe(testCase.input);
    return {
      input: testCase.input,
      description: testCase.description,
      parsed,
      formatted: getFormattedETA({ 
        team_id: 'TEST', 
        team_name: 'Test Team', 
        player: 'Test Player',
        injury_raw: 'Test Injury',
        returning_raw: testCase.input,
        ...parsed 
      })
    };
  });

  return NextResponse.json({
    success: true,
    message: 'Enhanced parsing rules demonstration',
    test_cases: results,
    timestamp: new Date().toISOString()
  });
}

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
  
  return {
    status: 'UNKNOWN',
    eta_weeks_min: null,
    eta_weeks_max: null,
    eta_days_min: null,
    eta_days_max: null,
    notes: original
  };
}

function getFormattedETA(injury) {
  switch (injury.status) {
    case 'TEST':
      return 'Being tested';
    case 'TBC':
      return 'To be confirmed';
    case 'SEASON':
      return 'Season ending';
    case 'PROTOCOLS':
      return 'Health protocols';
    case 'WEEKS':
      if (injury.eta_weeks_min !== undefined && injury.eta_weeks_min !== null) {
        if (injury.eta_weeks_max === null) {
          return `${injury.eta_weeks_min}+ week${injury.eta_weeks_min !== 1 ? 's' : ''}`;
        }
        if (injury.eta_weeks_max !== undefined && injury.eta_weeks_max !== null) {
          if (injury.eta_weeks_min === injury.eta_weeks_max) {
            return `${injury.eta_weeks_min} week${injury.eta_weeks_min !== 1 ? 's' : ''}`;
          }
          return `${injury.eta_weeks_min}-${injury.eta_weeks_max} weeks`;
        }
      }
      return 'Several weeks';
    case 'DAYS':
      if (injury.eta_days_min !== undefined && injury.eta_days_min !== null) {
        if (injury.eta_days_max === null) {
          return `${injury.eta_days_min}+ day${injury.eta_days_min !== 1 ? 's' : ''}`;
        }
        if (injury.eta_days_max !== undefined && injury.eta_days_max !== null) {
          if (injury.eta_days_min === injury.eta_days_max) {
            return `${injury.eta_days_min} day${injury.eta_days_min !== 1 ? 's' : ''}`;
          }
          return `${injury.eta_days_min}-${injury.eta_days_max} days`;
        }
      }
      return 'Several days';
    case 'UNKNOWN':
    default:
      return injury.returning_raw || 'Unknown';
  }
}
