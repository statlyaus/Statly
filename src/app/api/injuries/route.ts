import { mockInjuryData } from '@/data/mockInjuryData';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

export async function GET() {
  try {
    // For now, use mock data to ensure the frontend works
    // Real scraping will be implemented once the UI is tested
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (_error) {
    return Response.json({
      success: true,
      data: mockInjuryData,
      source: 'mock',
      count: mockInjuryData.length,
      lastUpdated: new Date().toISOString()
    });
  }
}
