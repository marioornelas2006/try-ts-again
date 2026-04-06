import { NextResponse } from 'next/server';
import { buildBriefing } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const route = String(formData.get('route') || '').trim();
    const altitudeFt = Number(formData.get('altitudeFt') || 0);
    const flightRules = String(formData.get('flightRules') || 'VFR').toUpperCase() === 'IFR' ? 'IFR' : 'VFR';
    const corridorMiles = Number(formData.get('corridorMiles') || 50);
    const uploadedFile = (formData.get('uploadedBriefing') as File | null) || null;

    if (!route) {
      return NextResponse.json({ error: 'Route is required.' }, { status: 400 });
    }
    if (!Number.isFinite(altitudeFt) || altitudeFt <= 0) {
      return NextResponse.json({ error: 'Cruise altitude must be greater than zero.' }, { status: 400 });
    }
    if (!Number.isFinite(corridorMiles) || corridorMiles < 1 || corridorMiles > 250) {
      return NextResponse.json({ error: 'Corridor miles must be between 1 and 250.' }, { status: 400 });
    }

    const result = await buildBriefing({
      route,
      altitudeFt,
      flightRules,
      corridorMiles,
      uploadedFile
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Briefing generation failed.' },
      { status: 500 }
    );
  }
}
