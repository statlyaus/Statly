// API endpoint for generating complete league schedules

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { 
  generateCompleteSchedule, 
  validateLeagueSettings,
  previewScheduleRequirements,
  type LeagueSettings 
} from '@/lib/scheduling';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings, action = 'generate' }: { 
      settings: LeagueSettings; 
      action?: 'generate' | 'validate' | 'preview' 
    } = body;

    if (!settings) {
      return NextResponse.json(
        { error: 'League settings are required' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'validate': {
        const validation = validateLeagueSettings(settings);
        return NextResponse.json(validation);
      }

      case 'preview': {
        const preview = previewScheduleRequirements(settings);
        return NextResponse.json(preview);
      }

      case 'generate':
      default: {
        // First validate settings
        const validation = validateLeagueSettings(settings);
        if (!validation.isValid) {
          return NextResponse.json(
            { 
              error: 'Invalid league settings', 
              details: validation.errors,
              warnings: validation.warnings 
            },
            { status: 400 }
          );
        }

        // Generate the complete schedule
        const result = generateCompleteSchedule(settings);
        
        if (!result.success) {
          return NextResponse.json(
            { error: result.error },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          schedule: result,
          validation: validation.warnings.length > 0 ? validation : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Schedule generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
