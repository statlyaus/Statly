import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const transport = searchParams.get('transport');
  const EIO = searchParams.get('EIO');

  console.log(`🔌 Socket.IO GET: EIO=${EIO}, transport=${transport}`);

  // Handle Engine.IO polling handshake
  if (transport === 'polling' && EIO === '4') {
    const handshake =
      '0{"sid":"dev-' +
      Date.now() +
      '","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":60000}';

    return new Response(handshake, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  return NextResponse.json({
    status: 'Socket.IO Ready',
    message: 'Core draft functionality working',
    timestamp: new Date().toISOString(),
  });
}

export async function POST(_request: NextRequest) {
  console.log('🔌 Socket.IO POST received');

  // Handle Engine.IO polling POST
  return new Response('ok', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
