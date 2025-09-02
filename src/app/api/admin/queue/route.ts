import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { draftQueue } from '@/api/queues/draftQueue';

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface JobInfo {
  id: string;
  name: string;
  data: Record<string, unknown>;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  delay?: number;
  attemptsMade: number;
  progress?: number;
}

interface QueueHealth {
  isHealthy: boolean;
  issues: string[];
  recommendations: string[];
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'stats':
        return await getQueueStats();
      case 'jobs':
        return await getJobsList(url.searchParams);
      case 'health':
        return await getQueueHealth();
      case 'metrics':
        return await getQueueMetrics();
      default:
        return await getQueueOverview();
    }
  } catch (error) {
    logger.error('Queue monitoring API error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to fetch queue information', 500);
  }
}

async function getQueueStats() {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      draftQueue.getWaiting(),
      draftQueue.getActive(),
      draftQueue.getCompleted(),
      draftQueue.getFailed(),
      draftQueue.getDelayed(),
    ]);

    const stats: QueueStats = {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: 0, // BullMQ doesn't have a paused state in the same way
    };

    return successResponse({
      stats,
      totalJobs: Object.values(stats).reduce((sum, count) => sum + count, 0),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get queue stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to get queue statistics', 500);
  }
}

async function getJobsList(searchParams: URLSearchParams) {
  try {
    const status = searchParams.get('status') || 'active';
    const limit = Number(searchParams.get('limit')) || 50;
    const offset = Number(searchParams.get('offset')) || 0;

    let jobs: unknown[] = [];

    switch (status) {
      case 'waiting':
        jobs = await draftQueue.getWaiting(offset, offset + limit);
        break;
      case 'active':
        jobs = await draftQueue.getActive(offset, offset + limit);
        break;
      case 'completed':
        jobs = await draftQueue.getCompleted(offset, offset + limit);
        break;
      case 'failed':
        jobs = await draftQueue.getFailed(offset, offset + limit);
        break;
      case 'delayed':
        jobs = await draftQueue.getDelayed(offset, offset + limit);
        break;
      default:
        return errorResponse('Invalid status parameter', 400);
    }

    const jobsInfo: JobInfo[] = jobs.map((job) => {
      // BullMQ Job interface type assertion
      const j = job as {
        id?: string;
        name?: string;
        data?: Record<string, unknown>;
        timestamp?: number;
        processedOn?: number;
        finishedOn?: number;
        failedReason?: string;
        delay?: number;
        attemptsMade?: number;
        progress?: number;
      };
      return {
        id: j.id || 'unknown',
        name: j.name || 'unknown',
        data: j.data || {},
        timestamp: j.timestamp || Date.now(),
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        failedReason: j.failedReason,
        delay: j.delay,
        attemptsMade: j.attemptsMade || 0,
        progress: j.progress,
      };
    });

    return successResponse({
      jobs: jobsInfo,
      status,
      count: jobsInfo.length,
      limit,
      offset,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get jobs list', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to get jobs list', 500);
  }
}

async function getQueueHealth() {
  try {
    const [waiting, active, failed, delayed] = await Promise.all([
      draftQueue.getWaiting(),
      draftQueue.getActive(),
      draftQueue.getFailed(),
      draftQueue.getDelayed(),
    ]);

    const health: QueueHealth = {
      isHealthy: true,
      issues: [],
      recommendations: [],
    };

    // Check for high failure rate
    const totalJobs = waiting.length + active.length + failed.length;
    const failureRate = totalJobs > 0 ? (failed.length / totalJobs) * 100 : 0;

    if (failureRate > 10) {
      health.isHealthy = false;
      health.issues.push(`High failure rate: ${failureRate.toFixed(1)}%`);
      health.recommendations.push('Review failed jobs and implement better error handling');
    }

    // Check for stuck jobs
    const now = Date.now();
    const stuckJobs = active.filter((job) => {
      const processedOn = job.processedOn ?? job.timestamp;
      return processedOn && now - processedOn > 5 * 60 * 1000;
    });

    if (stuckJobs.length > 0) {
      health.isHealthy = false;
      health.issues.push(`${stuckJobs.length} potentially stuck jobs detected`);
      health.recommendations.push('Review active jobs for stalled processing');
    }

    // Check for large backlog
    if (waiting.length > 100) {
      health.issues.push(`Large job backlog: ${waiting.length} waiting jobs`);
      health.recommendations.push(
        'Consider scaling up workers or reviewing job processing efficiency'
      );
    }

    // Check for too many delayed jobs
    if (delayed.length > 50) {
      health.issues.push(`Many delayed jobs: ${delayed.length} delayed jobs`);
      health.recommendations.push('Review job scheduling and delay patterns');
    }

    return successResponse({
      health,
      counts: {
        waiting: waiting.length,
        active: active.length,
        failed: failed.length,
        delayed: delayed.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get queue health', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to get queue health', 500);
  }
}

async function getQueueMetrics() {
  try {
    // Get job counts by hour for the last 24 hours
    const completed = await draftQueue.getCompleted(0, 1000);
    const failed = await draftQueue.getFailed(0, 1000);

    const hourlyMetrics = new Map<string, { completed: number; failed: number }>();
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // Initialize last 24 hourly buckets (YYYY-MM-DDTHH)
    for (let i = 0; i < 24; i++) {
      const hourStart = new Date(now - i * 60 * 60 * 1000);
      const hourKey = hourStart.toISOString().substring(0, 13); // YYYY-MM-DDTHH
      hourlyMetrics.set(hourKey, { completed: 0, failed: 0 });
    }

    // Count completed jobs by hour
    completed
      .filter((job) => job.finishedOn && job.finishedOn > twentyFourHoursAgo)
      .forEach((job) => {
        const hourKey = new Date(job.finishedOn!).toISOString().substring(0, 13);
        const metrics = hourlyMetrics.get(hourKey);
        if (metrics) {
          metrics.completed++;
        }
      });

    // Count failed jobs by hour
    failed
      .filter((job) => job.finishedOn && job.finishedOn > twentyFourHoursAgo)
      .forEach((job) => {
        const hourKey = new Date(job.finishedOn!).toISOString().substring(0, 13);
        const metrics = hourlyMetrics.get(hourKey);
        if (metrics) {
          metrics.failed++;
        }
      });

    // Calculate processing times
    const recentCompleted = completed
      .filter((job) => job.finishedOn && job.processedOn)
      .slice(0, 100); // Last 100 completed jobs

    const processingTimes = recentCompleted.map((job) => job.finishedOn! - job.processedOn!);

    const avgProcessingTime =
      processingTimes.length > 0
        ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
        : 0;

    return successResponse({
      hourlyMetrics: Array.from(hourlyMetrics.entries()).map(([hour, metrics]) => ({
        hour,
        ...metrics,
      })),
      processingMetrics: {
        averageProcessingTime: avgProcessingTime,
        minProcessingTime: Math.min(...processingTimes) || 0,
        maxProcessingTime: Math.max(...processingTimes) || 0,
        sampleSize: processingTimes.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get queue metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to get queue metrics', 500);
  }
}

async function getQueueOverview() {
  try {
    // Get basic queue information
    const [statsResponse, healthResponse] = await Promise.all([getQueueStats(), getQueueHealth()]);

    if (!statsResponse.ok || !healthResponse.ok) {
      return errorResponse('Failed to get queue overview', 500);
    }

    const stats = await statsResponse.json();
    const health = await healthResponse.json();

    return successResponse({
      overview: {
        queueName: 'draftQueue',
        isHealthy: health.data.health.isHealthy,
        totalJobs: stats.data.totalJobs,
        activeJobs: stats.data.stats.active,
        waitingJobs: stats.data.stats.waiting,
        failedJobs: stats.data.stats.failed,
        issues: health.data.health.issues,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get queue overview', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to get queue overview', 500);
  }
}

// POST endpoint for queue management actions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, jobId, data } = body;

    switch (action) {
      case 'pause':
        await draftQueue.pause();
        logger.info('Draft queue paused');
        return successResponse({ message: 'Queue paused successfully' });

      case 'resume':
        await draftQueue.resume();
        logger.info('Draft queue resumed');
        return successResponse({ message: 'Queue resumed successfully' });

      case 'retry-job': {
        if (!jobId) {
          return errorResponse('Job ID is required for retry', 400);
        }
        const job = await draftQueue.getJob(jobId);
        if (!job) {
          return errorResponse('Job not found', 404);
        }
        await job.retry();
        logger.info('Job retried', { jobId });
        return successResponse({ message: 'Job retried successfully' });
      }

      case 'remove-job':
        if (!jobId) {
          return errorResponse('Job ID is required for removal', 400);
        }
        await draftQueue.remove(jobId);
        logger.info('Job removed', { jobId });
        return successResponse({ message: 'Job removed successfully' });

      case 'clean': {
        const olderThan = data?.olderThan || 24 * 60 * 60 * 1000; // 24 hours
        const limit = data?.limit || 100;
        await draftQueue.clean(olderThan, limit);
        logger.info('Queue cleaned', { olderThan, limit });
        return successResponse({ message: 'Queue cleaned successfully' });
      }

      default:
        return errorResponse('Invalid action', 400);
    }
  } catch (error) {
    logger.error('Queue management action failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Queue management action failed', 500);
  }
}
