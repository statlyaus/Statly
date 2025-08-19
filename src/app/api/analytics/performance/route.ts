import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const performanceMetricSchema = z.object({
  name: z.string(),
  value: z.number(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  delta: z.number(),
  id: z.string(),
  navigationType: z.string(),
  sessionId: z.string(),
  timestamp: z.number(),
  url: z.string(),
  userAgent: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const metric = performanceMetricSchema.parse(body);

    // Log the performance metric
    logger.info('Performance metric received', {
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      sessionId: metric.sessionId,
      url: metric.url,
      timestamp: new Date(metric.timestamp).toISOString(),
    });

    // In a real application, you might want to:
    // 1. Store metrics in a time-series database (e.g., InfluxDB, TimescaleDB)
    // 2. Send to external analytics service (e.g., DataDog, New Relic)
    // 3. Aggregate metrics for dashboards
    
    // For now, we'll just acknowledge receipt
    return NextResponse.json({ 
      success: true, 
      message: 'Performance metric recorded' 
    });

  } catch (error) {
    logger.error('Failed to process performance metric', error);
    
    return NextResponse.json(
      { success: false, error: 'Invalid metric data' },
      { status: 400 }
    );
  }
}

// Optional: GET endpoint to retrieve performance metrics summary
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const timeRange = searchParams.get('timeRange') || '1h';

    // In a real application, you would query your metrics database here
    // For now, return a mock response
    const mockMetrics = {
      sessionId,
      timeRange,
      metrics: {
        CLS: { value: 0.1, rating: 'good' },
        FID: { value: 50, rating: 'good' },
        FCP: { value: 1200, rating: 'good' },
        LCP: { value: 2100, rating: 'good' },
        TTFB: { value: 200, rating: 'good' },
      },
      summary: {
        totalSessions: 150,
        averagePageLoadTime: 1800,
        performanceScore: 85,
      },
    };

    return NextResponse.json(mockMetrics);

  } catch (error) {
    logger.error('Failed to retrieve performance metrics', error);
    
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve metrics' },
      { status: 500 }
    );
  }
}
