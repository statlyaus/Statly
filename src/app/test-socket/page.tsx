"use client";

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export default function TestSocketPage() {
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    console.log(message);
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  useEffect(() => {
    addLog('🔌 Starting Socket.IO connection test...');
    
    const socket = io('http://localhost:3002', {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      autoConnect: true,
      forceNew: true
    });

    socket.on('connect', () => {
      addLog('✅ Connected successfully!');
      setConnectionStatus('Connected');
    });

    socket.on('disconnect', (reason) => {
      addLog(`❌ Disconnected: ${reason}`);
      setConnectionStatus('Disconnected');
    });

    socket.on('connect_error', (error) => {
      addLog(`❌ Connection error: ${error.message}`);
      setConnectionStatus('Error');
    });

    socket.on('error', (error) => {
      addLog(`❌ Socket error: ${error}`);
    });

    // Test emitting an event
    setTimeout(() => {
      addLog('📤 Testing emit...');
      socket.emit('test', { message: 'Hello from client' });
    }, 2000);

    return () => {
      addLog('🔌 Cleaning up socket connection...');
      socket.disconnect();
    };
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Socket.IO Connection Test</h1>
      
      <div className="mb-4">
        <strong>Status: </strong>
        <span className={`px-2 py-1 rounded ${
          connectionStatus === 'Connected' ? 'bg-green-100 text-green-800' :
          connectionStatus === 'Error' ? 'bg-red-100 text-red-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {connectionStatus}
        </span>
      </div>

      <div className="bg-gray-100 p-4 rounded">
        <h2 className="font-bold mb-2">Connection Logs:</h2>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {logs.map((log, index) => (
            <div key={index} className="text-sm font-mono">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
