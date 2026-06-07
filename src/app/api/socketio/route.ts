import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const socketRouteHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const transport = searchParams.get('transport');
  const EIO = searchParams.get('EIO');

  if (transport === 'polling' && EIO === '4') {
    return NextResponse.json(
      { error: 'Socket.IO polling handshakes are served by the dedicated socket server.' },
      { status: 404, headers: socketRouteHeaders }
    );
  }

  return NextResponse.json(
    { error: 'Use the configured Socket.IO server URL for realtime draft connections.' },
    { status: 404, headers: socketRouteHeaders }
  );
}

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Socket.IO POST handshakes are served by the dedicated socket server.' },
    { status: 404, headers: socketRouteHeaders }
  );
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 200,
    headers: socketRouteHeaders,
  });
}
