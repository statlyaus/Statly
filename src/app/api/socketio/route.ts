import type { NextRequest } from 'next/server';

// Simple WebSocket connection status endpoint
export async function GET(_request: NextRequest) {
  return new Response(JSON.stringify({
    status: 'WebSocket server ready',
    endpoint: '/api/socketio',
    timestamp: new Date().toISOString()
  }), { 
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function POST(_request: NextRequest) {
  return new Response(JSON.stringify({
    status: 'WebSocket server ready',
    endpoint: '/api/socketio',
    timestamp: new Date().toISOString()
  }), { 
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
