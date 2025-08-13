import type { NextRequest } from 'next/server';

// Simple Socket.IO mock for development
// This prevents the xhr poll errors while we focus on other functionality

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transport = searchParams.get('transport');
    const eio = searchParams.get('EIO');
    
    console.log(`� Socket.IO GET request - EIO: ${eio}, Transport: ${transport}`);
    
    // Handle Socket.IO Engine.IO polling requests
    if (transport === 'polling' && eio === '4') {
      // Simulate a basic Engine.IO handshake response
      const handshakeResponse = '0{"sid":"mock-session-id","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":5000}';
      
      return new Response(handshakeResponse, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'false',
        }
      });
    }

    // Default response for other requests
    return new Response(
      JSON.stringify({
        status: 'Mock Socket.IO server',
        message: 'WebSocket connection simulated for development',
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    console.error('Socket.IO GET error:', error);
    return new Response('Socket.IO error', { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transport = searchParams.get('transport');
    const eio = searchParams.get('EIO');
    
    console.log(`🔄 Socket.IO POST request - EIO: ${eio}, Transport: ${transport}`);
    
    // Handle Socket.IO polling POST requests
    if (transport === 'polling' && eio === '4') {
      // Simulate successful polling response
      return new Response('ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    return new Response('Mock Socket.IO POST handled', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Socket.IO POST error:', error);
    return new Response('Socket.IO error', { status: 500 });
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  });
}
