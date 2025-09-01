'use client';

import { useState } from 'react';
import ErrorTestButton from '@/components/ErrorTestButton';
import { 
  captureError, 
  captureMessage, 
  addBreadcrumb, 
  setTag, 
  setExtra,
  startTransaction 
} from '@/lib/sentry-utils';

export default function SentryTestPage() {
  const [testResults, setTestResults] = useState<string[]>([]);

  const addResult = (message: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const testErrorCapture = () => {
    try {
      throw new Error('Manual error test from Sentry test page');
    } catch (error) {
      captureError(error as Error, { context: 'sentry-test-page', testType: 'manual' });
      addResult('✅ Error captured and sent to Sentry');
    }
  };

  const testMessageCapture = () => {
    captureMessage('Test message from Sentry test page', 'info');
    addResult('✅ Info message sent to Sentry');
  };

  const testWarningCapture = () => {
    captureMessage('Test warning from Sentry test page', 'warning');
    addResult('✅ Warning message sent to Sentry');
  };

  const testBreadcrumb = () => {
    addBreadcrumb('User clicked test button', 'ui', 'info', { buttonId: 'test-breadcrumb' });
    addResult('✅ Breadcrumb added to Sentry');
  };

  const testTag = () => {
    setTag('test-environment', 'development');
    setTag('test-user', 'developer');
    addResult('✅ Tags set in Sentry');
  };

  const testExtra = () => {
    setExtra('test-data', { timestamp: Date.now(), random: Math.random() });
    setExtra('user-actions', ['clicked', 'tested', 'verified']);
    addResult('✅ Extra context data set in Sentry');
  };

  const testPerformance = () => {
    const transaction = startTransaction('Sentry Test Transaction', 'test', { 
      testType: 'performance',
      timestamp: Date.now()
    });
    
    // Simulate some work
    setTimeout(() => {
      transaction.finish();
      addResult('✅ Performance transaction completed and sent to Sentry');
    }, 1000);
    
    addResult('🚀 Performance transaction started...');
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">🐛 Sentry Testing Dashboard</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Test Controls */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">Test Controls</h2>
              
              <div className="space-y-3">
                <button
                  onClick={testErrorCapture}
                  className="w-full bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  🚨 Test Error Capture
                </button>
                
                <button
                  onClick={testMessageCapture}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  💬 Test Info Message
                </button>
                
                <button
                  onClick={testWarningCapture}
                  className="w-full bg-yellow-600 text-white py-2 px-4 rounded hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                >
                  ⚠️ Test Warning Message
                </button>
                
                <button
                  onClick={testBreadcrumb}
                  className="w-full bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  🍞 Test Breadcrumb
                </button>
                
                <button
                  onClick={testTag}
                  className="w-full bg-purple-600 text-white py-2 px-4 rounded hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  🏷️ Test Tags
                </button>
                
                <button
                  onClick={testExtra}
                  className="w-full bg-indigo-600 text-white py-2 px-4 rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  📊 Test Extra Context
                </button>
                
                <button
                  onClick={testPerformance}
                  className="w-full bg-teal-600 text-white py-2 px-4 rounded hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  ⚡ Test Performance
                </button>
              </div>
              
              <div className="border-t pt-4">
                <h3 className="text-lg font-medium text-gray-700 mb-2">🚨 Intentional Error Test</h3>
                <ErrorTestButton />
                <p className="text-sm text-gray-500 mt-2">
                  This will throw an error and test Sentry's error boundary
                </p>
              </div>
            </div>
            
            {/* Test Results */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Test Results</h2>
                <button
                  onClick={clearResults}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear Results
                </button>
              </div>
              
              <div className="bg-gray-100 rounded-lg p-4 h-96 overflow-y-auto">
                {testResults.length === 0 ? (
                  <p className="text-gray-500 text-center mt-8">
                    No test results yet. Click the test buttons to see results here.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {testResults.map((result, index) => (
                      <div key={index} className="text-sm font-mono bg-white p-2 rounded border">
                        {result}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">📋 What to Check</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Check your Sentry dashboard for new events</li>
                  <li>• Verify error stack traces are readable</li>
                  <li>• Check that breadcrumbs and context are captured</li>
                  <li>• Monitor performance transactions</li>
                  <li>• Test error boundary functionality</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
