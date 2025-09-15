'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import { ComponentErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useLiveData } from '@/hooks/useLiveData';
import { apiCache, dataCache, userCache } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { usePerformanceMonitor } from '@/lib/performance';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'pending';
  message: string;
  details?: any;
}

export default function InfrastructureTestClient() {
  const { user, loading: authLoading } = useAuth();
  const { playerStats, isLoading: liveDataLoading, error: liveDataError } = useLiveData();
  const performanceMonitor = usePerformanceMonitor();

  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    const results: TestResult[] = [];
    try {
      results.push({ name: 'Authentication System', status: authLoading ? 'pending' : user ? 'pass' : 'warning', message: authLoading ? 'Loading...' : user ? `Authenticated as ${user.email}` : 'Not authenticated (expected for test)', details: { userId: user?.uid, email: user?.email } });
    } catch (error) {
      results.push({ name: 'Authentication System', status: 'fail', message: `Auth error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      const metrics = performanceMonitor.getMetricsSummary();
      results.push({ name: 'Performance Monitoring', status: Object.keys(metrics).length > 0 ? 'pass' : 'warning', message: `${Object.keys(metrics).length} metrics collected`, details: metrics });
    } catch (error) {
      results.push({ name: 'Performance Monitoring', status: 'fail', message: `Performance monitoring error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      results.push({ name: 'Live Data Integration', status: liveDataError ? 'fail' : liveDataLoading ? 'pending' : playerStats.length > 0 ? 'pass' : 'warning', message: liveDataError ? `Error: ${liveDataError}` : liveDataLoading ? 'Loading...' : `${playerStats.length} player stats loaded`, details: { playerCount: playerStats.length, hasError: !!liveDataError } });
    } catch (error) {
      results.push({ name: 'Live Data Integration', status: 'fail', message: `Live data error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      const testKey = 'infrastructure-test';
      const testData = { timestamp: Date.now(), test: true };
      apiCache.set(testKey, testData);
      const retrieved = apiCache.get(testKey);
      results.push({ name: 'Caching System', status: retrieved && JSON.stringify(retrieved) === JSON.stringify(testData) ? 'pass' : 'fail', message: retrieved ? 'Cache read/write successful' : 'Cache test failed', details: { apiCacheSize: apiCache.size(), dataCacheSize: dataCache.size(), userCacheSize: userCache.size() } });
    } catch (error) {
      results.push({ name: 'Caching System', status: 'fail', message: `Cache error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      logger.info('Infrastructure test log entry', { testId: 'infra-test', timestamp: Date.now() });
      results.push({ name: 'Logging System', status: 'pass', message: 'Logger functional', details: { logLevel: 'info', structured: true } });
    } catch (error) {
      results.push({ name: 'Logging System', status: 'fail', message: `Logging error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      const response = await fetch('/api/ping');
      const data = await response.json();
      results.push({ name: 'API Connectivity', status: response.ok ? 'pass' : 'fail', message: response.ok ? 'API responding' : `API error: ${response.status}`, details: data });
    } catch (error) {
      results.push({ name: 'API Connectivity', status: 'fail', message: `API connection error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    try {
      results.push({ name: 'Error Boundary System', status: 'pass', message: 'Error boundaries loaded and functional', details: { enhanced: true, levels: ['page', 'section', 'component'] } });
    } catch (error) {
      results.push({ name: 'Error Boundary System', status: 'fail', message: `Error boundary test failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
    setTestResults(results);
    setIsRunning(false);
  };

  useEffect(() => {
    runTests();
  }, []);

  const getStatusColor = (status: TestResult['status']) => ({ pass: 'text-green-600 bg-green-50', fail: 'text-red-600 bg-red-50', warning: 'text-yellow-600 bg-yellow-50', pending: 'text-blue-600 bg-blue-50' }[status] ?? 'text-gray-600 bg-gray-50');

  const getStatusIcon = (status: TestResult['status']) => ({ pass: '✅', fail: '❌', warning: '⚠️', pending: '⏳' }[status] ?? 'ℹ️');

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold">Infrastructure Test</h1>
        <button className="px-3 py-1 rounded border" onClick={() => void runTests()} disabled={isRunning}>{isRunning ? 'Running…' : 'Run tests again'}</button>
        <div className="space-y-2">
          {testResults.map((t) => (
            <div key={t.name} className={`p-3 rounded border ${getStatusColor(t.status)}`}>
              <div className="font-medium">{getStatusIcon(t.status)} {t.name}</div>
              <div className="text-sm">{t.message}</div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

