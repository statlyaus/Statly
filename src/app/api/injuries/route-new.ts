import { NextResponse } from 'next/server';

import { getInjuriesByTeam } from '../../../data/mockInjuryData';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamFilter = searchParams.get('team');

  // Use structured mock data to ensure proper UI display
  // This bypasses scraping issues that cause text block display
  console.log('Using structured mock injury data for optimal UI display');

  const mockInjuries = getInjuriesByTeam(teamFilter || undefined);

  // Filter if team filter is provided
  const filteredMockInjuries = teamFilter
    ? mockInjuries.filter((injury) => injury.team.toLowerCase().includes(teamFilter.toLowerCase()))
    : mockInjuries;

  // Remove duplicates
  const uniqueMockInjuries = filteredMockInjuries.filter(
    (injury, index, self) => index === self.findIndex((i) => i.id === injury.id)
  );

  console.log(
    `Returning ${uniqueMockInjuries.length} structured injury records${teamFilter ? ` for team: ${teamFilter}` : ''}`
  );

  return NextResponse.json({
    success: true,
    data: uniqueMockInjuries,
    count: uniqueMockInjuries.length,
    lastUpdated: new Date().toISOString(),
    teamFilter: teamFilter || null,
    note: 'Using structured mock data for optimal UI display',
  });
}
