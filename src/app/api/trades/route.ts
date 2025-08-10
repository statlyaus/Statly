import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { incoming, outgoing } = await request.json();
    if (!Array.isArray(incoming) || !Array.isArray(outgoing)) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (_err) {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
