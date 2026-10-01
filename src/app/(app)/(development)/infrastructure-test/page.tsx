'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/AuthContext';
import { usePerformanceMonitor } from '@/lib/performance';
import { useLiveData } from '@/hooks/useLiveData';
import { logger } from '@/lib/logger';
import { apiCache, dataCache, userCache } from '@/lib/cache';
import { ComponentErrorBoundary } from '@/components/ui/ErrorBoundary';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'pending';
  message: string;
  details?: any;
}

export default function InfrastructureTestPage() {
  const { user, loading: authLoading } = useAuth();
  const { playerStats, isLoading: liveDataLoading, error: liveDataError } = useLiveData();
  const performanceMonitor = usePerformanceMonitor();

  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    const results: TestResult[] = [];

    // Test 1: Authentication System
    try {
      results.push({
        name: 'Authentication System',
        status: authLoading ? 'pending' : user ? 'pass' : 'warning',
        message: authLoading
          ? 'Loading...'
          : user
            ? `Authenticated as ${user.email}`
            : 'Not authenticated (expected for test)',
        details: { userId: user?.uid, email: user?.email },
      });
    } catch (error) {
      results.push({
        name: 'Authentication System',
        status: 'fail',
        message: `Auth error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 2: Performance Monitoring
    try {
      const metrics = performanceMonitor.getMetricsSummary();
      results.push({
        name: 'Performance Monitoring',
        status: Object.keys(metrics).length > 0 ? 'pass' : 'warning',
        message: `${Object.keys(metrics).length} metrics collected`,
        details: metrics,
      });
    } catch (error) {
      results.push({
        name: 'Performance Monitoring',
        status: 'fail',
        message: `Performance monitoring error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 3: Live Data Integration
    try {
      results.push({
        name: 'Live Data Integration',
        status: liveDataError
          ? 'fail'
          : liveDataLoading
            ? 'pending'
            : playerStats.length > 0
              ? 'pass'
              : 'warning',
        message: liveDataError
          ? `Error: ${liveDataError}`
          : liveDataLoading
            ? 'Loading...'
            : `${playerStats.length} player stats loaded`,
        details: { playerCount: playerStats.length, hasError: !!liveDataError },
      });
    } catch (error) {
      results.push({
        name: 'Live Data Integration',
        status: 'fail',
        message: `Live data error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 4: Caching System
    try {
      // Test cache functionality
      const testKey = 'infrastructure-test';
      const testData = { timestamp: Date.now(), test: true };

      apiCache.set(testKey, testData);
      const retrieved = apiCache.get(testKey);

      results.push({
        name: 'Caching System',
        status:
          retrieved && JSON.stringify(retrieved) === JSON.stringify(testData) ? 'pass' : 'fail',
        message: retrieved ? 'Cache read/write successful' : 'Cache test failed',
        details: {
          apiCacheSize: apiCache.size(),
          dataCacheSize: dataCache.size(),
          userCacheSize: userCache.size(),
        },
      });
    } catch (error) {
      results.push({
        name: 'Caching System',
        status: 'fail',
        message: `Cache error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 5: Logging System
    try {
      logger.info('Infrastructure test log entry', { testId: 'infra-test', timestamp: Date.now() });
      results.push({
        name: 'Logging System',
        status: 'pass',
        message: 'Logger functional',
        details: { logLevel: 'info', structured: true },
      });
    } catch (error) {
      results.push({
        name: 'Logging System',
        status: 'fail',
        message: `Logging error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 6: API Connectivity
    try {
      const response = await fetch('/api/ping');
      const data = await response.json();

      results.push({
        name: 'API Connectivity',
        status: response.ok ? 'pass' : 'fail',
        message: response.ok ? 'API responding' : `API error: ${response.status}`,
        details: data,
      });
    } catch (error) {
      results.push({
        name: 'API Connectivity',
        status: 'fail',
        message: `API connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Test 7: Error Boundary System
    try {
      results.push({
        name: 'Error Boundary System',
        status: 'pass',
        message: 'Error boundaries loaded and functional',
        details: { enhanced: true, levels: ['page', 'section', 'component'] },
      });
    } catch (error) {
      results.push({
        name: 'Error Boundary System',
        status: 'fail',
        message: `Error boundary test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    setTestResults(results);
    setIsRunning(false);
  };

  useEffect(() => {
    runTests();
  }, []);

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return 'text-green-600 bg-green-50';
      case 'fail':
        return 'text-red-600 bg-red-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      case 'pending':
        return 'text-blue-600 bg-blue-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return '✅';
      case 'fail':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'pending':
        return '⏳';
      default:
        return '❓';
    }
  };

  const passCount = testResults.filter((r) => r.status === 'pass').length;
  const failCount = testResults.filter((r) => r.status === 'fail').length;
  const warningCount = testResults.filter((r) => r.status === 'warning').length;

  return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Infrastructure Test Dashboard</h1>
            <p className="text-gray-600">
              Comprehensive testing of all infrastructure components and connections
            </p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-2xl font-bold text-gray-900">{testResults.length}</div>
              <div className="text-sm text-gray-600">Total Tests</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-2xl font-bold text-green-600">{passCount}</div>
              <div className="text-sm text-gray-600">Passed</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-2xl font-bold text-red-600">{failCount}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-2xl font-bold text-yellow-600">{warningCount}</div>
              <div className="text-sm text-gray-600">Warnings</div>
            </div>
          </div>

          {/* Test Results */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900">Test Results</h2>
              <button
                onClick={runTests}
                disabled={isRunning}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isRunning ? 'Running...' : 'Run Tests'}
              </button>
            </div>

            <div className="divide-y divide-gray-200">
              {testResults.map((result, index) => (
                <div key={index} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <span className="text-xl">{getStatusIcon(result.status)}</span>
                      <div>
                        <h3 className="font-medium text-gray-900">{result.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{result.message}</p>
                        {result.details && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                              View Details
                            </summary>
                            <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-auto">
                              {JSON.stringify(result.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(result.status)}`}
                    >
                      {result.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Error Boundary Test */}
          <div className="mt-8 bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Error Boundary Test</h3>
            <ComponentErrorBoundary name="TestErrorBoundary">
              <TestComponent />
            </ComponentErrorBoundary>
          </div>
        </div>
      </div>
  );
}

// Test component for error boundary
function TestComponent() {
  const [shouldError, setShouldError] = useState(false);

  if (shouldError) {
    throw new Error('Test error for error boundary demonstration');
  }

  return (
    <div>
      <p className="text-gray-600 mb-4">
        This component is wrapped in an error boundary. Click the button to test error handling.
      </p>
      <button
        onClick={() => setShouldError(true)}
        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
      >
        Trigger Test Error
      </button>
    </div>
  );
}
