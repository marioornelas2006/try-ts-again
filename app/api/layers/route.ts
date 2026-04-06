import { NextResponse } from 'next/server';
import { radarTileInfo } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    radar: radarTileInfo,
    note: 'GeoJSON advisory layers are loaded from the briefing response.'
  });
}
