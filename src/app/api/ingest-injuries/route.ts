// Backend ingestion system for injury data
// Handles flat text blocks with team headers and player rows

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

interface ParsedInjuryRecord {
  team_id: string;
  team_name: string;
  player: string;
  injury_raw: string;
  returning_raw: string;
  status: 'TEST' | 'TBC' | 'SEASON' | 'PROTOCOLS' | 'WEEKS' | 'DAYS' | 'UNKNOWN';
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface IngestionResult {
  total_processed: number;
  new_records: number;
  updated_records: number;
  skipped_records: number;
  errors: Array<{
    line: number;
    error: string;
    raw_data?: string;
  }>;
  records: ParsedInjuryRecord[];
}

// Team mapping to standardize team names and codes
const TEAM_MAPPING: Record<string, { id: string; name: string }> = {
  'Adelaide Crows': { id: 'ADL', name: 'Adelaide Crows' },
  Adelaide: { id: 'ADL', name: 'Adelaide Crows' },
  'Brisbane Lions': { id: 'BRI', name: 'Brisbane Lions' },
  Brisbane: { id: 'BRI', name: 'Brisbane Lions' },
  'Carlton Blues': { id: 'CAR', name: 'Carlton Blues' },
  Carlton: { id: 'CAR', name: 'Carlton Blues' },
  'Collingwood Magpies': { id: 'COL', name: 'Collingwood Magpies' },
  Collingwood: { id: 'COL', name: 'Collingwood Magpies' },
  'Essendon Bombers': { id: 'ESS', name: 'Essendon Bombers' },
  Essendon: { id: 'ESS', name: 'Essendon Bombers' },
  'Fremantle Dockers': { id: 'FRE', name: 'Fremantle Dockers' },
  Fremantle: { id: 'FRE', name: 'Fremantle Dockers' },
  'Geelong Cats': { id: 'GEE', name: 'Geelong Cats' },
  Geelong: { id: 'GEE', name: 'Geelong Cats' },
  'Gold Coast Suns': { id: 'GCS', name: 'Gold Coast Suns' },
  'Gold Coast': { id: 'GCS', name: 'Gold Coast Suns' },
  'GWS Giants': { id: 'GWS', name: 'GWS Giants' },
  GWS: { id: 'GWS', name: 'GWS Giants' },
  'Greater Western Sydney': { id: 'GWS', name: 'GWS Giants' },
  'Hawthorn Hawks': { id: 'HAW', name: 'Hawthorn Hawks' },
  Hawthorn: { id: 'HAW', name: 'Hawthorn Hawks' },
  'Melbourne Demons': { id: 'MEL', name: 'Melbourne Demons' },
  Melbourne: { id: 'MEL', name: 'Melbourne Demons' },
  'North Melbourne Kangaroos': { id: 'NTH', name: 'North Melbourne Kangaroos' },
  'North Melbourne': { id: 'NTH', name: 'North Melbourne Kangaroos' },
  'Port Adelaide Power': { id: 'PAP', name: 'Port Adelaide Power' },
  'Port Adelaide': { id: 'PAP', name: 'Port Adelaide Power' },
  'Richmond Tigers': { id: 'RIC', name: 'Richmond Tigers' },
  Richmond: { id: 'RIC', name: 'Richmond Tigers' },
  'St Kilda Saints': { id: 'STK', name: 'St Kilda Saints' },
  'St Kilda': { id: 'STK', name: 'St Kilda Saints' },
  'Sydney Swans': { id: 'SYD', name: 'Sydney Swans' },
  Sydney: { id: 'SYD', name: 'Sydney Swans' },
  'West Coast Eagles': { id: 'WCE', name: 'West Coast Eagles' },
  'West Coast': { id: 'WCE', name: 'West Coast Eagles' },
  'Western Bulldogs': { id: 'WBD', name: 'Western Bulldogs' },
  Western: { id: 'WBD', name: 'Western Bulldogs' },
};

/**
 * Enhanced parsing for return timeframes with all normalization rules
 */
function parseReturnTimeframe(returning: string): {
  status: ParsedInjuryRecord['status'];
  eta_weeks_min: number | null;
  eta_weeks_max: number | null;
  eta_days_min: number | null;
  eta_days_max: number | null;
  notes: string | null;
} {
  if (!returning || returning.trim() === '') {
    return {
      status: 'UNKNOWN',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: null,
      eta_days_max: null,
      notes: null,
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
      notes: null,
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
      notes: null,
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
      notes: null,
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
      notes: null,
    };
  }

  // Rule: (\d+)\s*-\s*(\d+)\s*week(s)? → status=WEEKS, min/max accordingly
  const weekRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*weeks?/);
  if (weekRangeMatch) {
    const min = parseInt(weekRangeMatch[1]);
    const max = parseInt(weekRangeMatch[2]);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'WEEKS',
      eta_weeks_min: min,
      eta_weeks_max: max,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null,
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
      notes: null,
    };
  }

  // Rule: (\d+)\s*week(s)? → status=WEEKS, eta_weeks_min=max(1, n), eta_weeks_max=n
  const weekSingleMatch = normalized.match(/(\d+)\s*weeks?/);
  if (weekSingleMatch) {
    const weeks = parseInt(weekSingleMatch[1]);
    const minWeeks = Math.max(1, weeks);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'WEEKS',
      eta_weeks_min: minWeeks,
      eta_weeks_max: weeks,
      eta_days_min: null,
      eta_days_max: null,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: (\d+)\s*-\s*(\d+)\s*day(s)? → status=DAYS, min/max accordingly
  const dayRangeMatch = normalized.match(/(\d+)\s*-\s*(\d+)\s*days?/);
  if (dayRangeMatch) {
    const min = parseInt(dayRangeMatch[1]);
    const max = parseInt(dayRangeMatch[2]);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: min,
      eta_days_max: max,
      notes: hasNotes ? original : null,
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
      notes: null,
    };
  }

  // Rule: (\d+)\s*day(s)? → status=DAYS, eta_days_min=max(1, n), eta_days_max=n
  const daySingleMatch = normalized.match(/(\d+)\s*days?/);
  if (daySingleMatch) {
    const days = parseInt(daySingleMatch[1]);
    const minDays = Math.max(1, days);
    const hasNotes =
      normalized.includes('(') || normalized.includes('reassess') || normalized.includes('review');

    return {
      status: 'DAYS',
      eta_weeks_min: null,
      eta_weeks_max: null,
      eta_days_min: minDays,
      eta_days_max: days,
      notes: hasNotes ? original : null,
    };
  }

  // Rule: Empty/unknown/missing text → status=UNKNOWN
  return {
    status: 'UNKNOWN',
    eta_weeks_min: null,
    eta_weeks_max: null,
    eta_days_min: null,
    eta_days_max: null,
    notes: original,
  };
}

/**
 * Parse flat text injury data into normalized records
 * Format: Team header: "Team Name (X Players)"
 * Followed by tab-separated rows: "Player\tInjury\tReturning"
 */
function parseInjuryTextBlock(textBlock: string): IngestionResult {
  const lines = textBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result: IngestionResult = {
    total_processed: 0,
    new_records: 0,
    updated_records: 0,
    skipped_records: 0,
    errors: [],
    records: [],
  };

  let currentTeam: { id: string; name: string } | null = null;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    // Detect team blocks by header regex: ^(.*)\s+\((\d+)\s+Players?\)
    const teamHeaderMatch = line.match(/^(.*?)\s+\((\d+)\s+Players?\)/i);
    if (teamHeaderMatch) {
      const teamNameRaw = teamHeaderMatch[1].trim();
      const playerCount = parseInt(teamHeaderMatch[2]);

      // Find team in mapping
      const teamInfo = TEAM_MAPPING[teamNameRaw];
      if (teamInfo) {
        currentTeam = teamInfo;
        logger.debug('Processing team', { teamName: teamInfo.name, playerCount });
      } else {
        result.errors.push({
          line: lineNumber,
          error: `Unknown team: ${teamNameRaw}`,
          raw_data: line,
        });
        currentTeam = null;
      }
      continue;
    }

    // Skip lines if no current team
    if (!currentTeam) {
      continue;
    }

    // Parse player rows: Player\tInjury\tReturning
    const columns = line.split('\t').map((col) => col.trim());
    if (columns.length < 3) {
      // Try splitting by multiple spaces as fallback
      const spaceColumns = line.split(/\s{2,}/).map((col) => col.trim());
      if (spaceColumns.length >= 3) {
        columns.splice(0, columns.length, ...spaceColumns);
      } else {
        result.errors.push({
          line: lineNumber,
          error: `Invalid row format - expected 3 columns (Player, Injury, Returning), got ${columns.length}`,
          raw_data: line,
        });
        continue;
      }
    }

    const [player, injury, returning] = columns;

    // Validate required fields
    if (!player || !injury || !returning) {
      result.errors.push({
        line: lineNumber,
        error: 'Missing required fields (player, injury, or returning)',
        raw_data: line,
      });
      continue;
    }

    // Clean and normalize data
    const playerClean = player.trim();
    const injuryClean = injury.trim();
    const returningClean = returning.trim();

    // Handle hyphen/plus variants robustly
    const returningNormalized = returningClean
      .replace(/–/g, '-') // Em dash to hyphen
      .replace(/−/g, '-') // Minus to hyphen
      .replace(/\+/g, '+') // Normalize plus signs
      .trim();

    try {
      // Parse return timeframe
      const parsedTimeframe = parseReturnTimeframe(returningNormalized);

      // Create normalized record
      const timestamp = new Date().toISOString();
      const record: ParsedInjuryRecord = {
        team_id: currentTeam.id,
        team_name: currentTeam.name,
        player: playerClean,
        injury_raw: injuryClean,
        returning_raw: returningNormalized,
        ...parsedTimeframe,
        created_at: timestamp,
        updated_at: timestamp,
      };

      result.records.push(record);
      result.total_processed++;
      result.new_records++; // In a real implementation, this would check for existing records
    } catch (error) {
      result.errors.push({
        line: lineNumber,
        error: `Parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        raw_data: line,
      });
    }
  }

  return result;
}

/**
 * Upsert logic: uniqueness key (team_id, player, injury_raw)
 * If returning_raw changes, update record and updated_at
 */
function upsertInjuryRecords(
  newRecords: ParsedInjuryRecord[],
  existingRecords: ParsedInjuryRecord[] = []
): IngestionResult {
  const result: IngestionResult = {
    total_processed: newRecords.length,
    new_records: 0,
    updated_records: 0,
    skipped_records: 0,
    errors: [],
    records: [],
  };

  // Create a map for fast lookups of existing records
  const existingMap = new Map<string, ParsedInjuryRecord>();
  existingRecords.forEach((record) => {
    const key = `${record.team_id}|${record.player}|${record.injury_raw}`;
    existingMap.set(key, record);
  });

  for (const newRecord of newRecords) {
    const key = `${newRecord.team_id}|${newRecord.player}|${newRecord.injury_raw}`;
    const existing = existingMap.get(key);

    if (!existing) {
      // New record
      result.records.push(newRecord);
      result.new_records++;
    } else if (existing.returning_raw !== newRecord.returning_raw) {
      // Update existing record with new returning timeframe
      const updatedRecord: ParsedInjuryRecord = {
        ...existing,
        returning_raw: newRecord.returning_raw,
        status: newRecord.status,
        eta_weeks_min: newRecord.eta_weeks_min,
        eta_weeks_max: newRecord.eta_weeks_max,
        eta_days_min: newRecord.eta_days_min,
        eta_days_max: newRecord.eta_days_max,
        notes: newRecord.notes,
        updated_at: new Date().toISOString(),
      };
      result.records.push(updatedRecord);
      result.updated_records++;
    } else {
      // No changes, skip
      result.records.push(existing);
      result.skipped_records++;
    }
  }

  return result;
}

/**
 * API endpoint for ingesting injury data via POST
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { textBlock, mode = 'parse' } = body;

    if (!textBlock || typeof textBlock !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing or invalid textBlock parameter',
        },
        { status: 400 }
      );
    }

    if (mode === 'parse') {
      // Parse only - don't persist
      const parseResult = parseInjuryTextBlock(textBlock);

      return NextResponse.json({
        success: true,
        message: 'Text block parsed successfully',
        mode: 'parse',
        result: parseResult,
        timestamp: new Date().toISOString(),
      });
    } else if (mode === 'ingest') {
      // Parse and upsert (in real implementation, would interact with database)
      const parseResult = parseInjuryTextBlock(textBlock);

      if (parseResult.errors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Parsing errors detected',
            errors: parseResult.errors,
            partial_result: parseResult,
          },
          { status: 400 }
        );
      }

      // In a real implementation, this would:
      // 1. Fetch existing records from database
      // 2. Run upsert logic
      // 3. Save to database
      // For demo, we'll just return the upsert simulation
      const upsertResult = upsertInjuryRecords(parseResult.records);

      return NextResponse.json({
        success: true,
        message: 'Injury data ingested successfully',
        mode: 'ingest',
        result: upsertResult,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid mode. Use "parse" or "ingest"',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('Ingestion error', error instanceof Error ? error : new Error(String(error)));
    return commonErrors.internalServerError('Internal server error during ingestion', {
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * API endpoint for testing with sample data
 */
export async function GET() {
  const sampleTextBlock = `Adelaide Crows (3 Players)
Taylor Walker	Hamstring	2-3 weeks
Rory Laird	Knee	TBC
Ben Keays	Shoulder	Test

Brisbane Lions (2 Players)
Lachie Neale	Ankle	1-2 weeks
Oscar McInerney	Back	Season

Collingwood Magpies (4 Players)
Scott Pendlebury	Calf	5-7 days
Mason Cox	Knee	6+ weeks
Jeremy Howe	Hamstring	2 weeks (reassess)
Darcy Cameron	Concussion protocols	TBC`;

  const parseResult = parseInjuryTextBlock(sampleTextBlock);

  return NextResponse.json({
    success: true,
    message: 'Sample ingestion demonstration',
    sample_input: sampleTextBlock,
    result: parseResult,
    timestamp: new Date().toISOString(),
  });
}
