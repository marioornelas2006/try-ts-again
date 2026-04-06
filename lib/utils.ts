import { LatLon, RunwayWindComponent } from './types';

export function parseRouteInput(route: string) {
  const normalized = route
    .toUpperCase()
    .replace(/->|–|—/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (normalized.length < 2) {
    throw new Error('Enter at least a departure and arrival airport, for example KLAF KIND.');
  }

  const waypoints = normalized;
  return {
    raw: route,
    departure: normalized[0],
    arrival: normalized[normalized.length - 1],
    waypoints
  };
}

export function haversineMiles(a: LatLon, b: LatLon) {
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

export function initialBearingDegrees(a: LatLon, b: LatLon) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function sampleGreatCircle(a: LatLon, b: LatLon, samples = 10): LatLon[] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const f = i / samples;
    return interpolate(a, b, f);
  });
}

export function interpolate(a: LatLon, b: LatLon, fraction: number): LatLon {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lon: a.lon + (b.lon - a.lon) * fraction
  };
}

export function buildLineString(points: LatLon[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map((p) => [p.lon, p.lat])
    }
  };
}

export function dedupeByIcao<T extends { icao: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.icao, item);
  }
  return Array.from(map.values());
}

export function computeRunwayWindComponents(runways: Array<Record<string, any>>, windDegrees?: number, windSpeedKt?: number): RunwayWindComponent[] {
  if (!Array.isArray(runways) || windDegrees == null || windSpeedKt == null) return [];

  const results: RunwayWindComponent[] = [];

  for (const runway of runways) {
    const entries: Array<{ ident?: string; heading?: number }> = [
      { ident: runway.le_ident, heading: numberOrNull(runway.le_heading_degT) ?? identToHeading(runway.le_ident) },
      { ident: runway.he_ident, heading: numberOrNull(runway.he_heading_degT) ?? identToHeading(runway.he_ident) }
    ];

    for (const entry of entries) {
      if (!entry.ident || entry.heading == null) continue;
      const relative = normalizeSignedDegrees(windDegrees - entry.heading);
      const headwind = Math.cos(toRad(relative)) * windSpeedKt;
      const crosswind = Math.sin(toRad(relative)) * windSpeedKt;

      results.push({
        runway: entry.ident,
        heading: Math.round(entry.heading),
        lengthFt: numberOrNull(runway.length_ft),
        widthFt: numberOrNull(runway.width_ft),
        surface: runway.surface ?? null,
        headwindKt: round1(headwind),
        crosswindKt: round1(Math.abs(crosswind)),
        crosswindDirection: Math.abs(crosswind) < 0.1 ? 'none' : crosswind > 0 ? 'right' : 'left',
        favored: headwind >= 0
      });
    }
  }

  return results.sort((a, b) => {
    if (b.headwindKt !== a.headwindKt) return b.headwindKt - a.headwindKt;
    return a.crosswindKt - b.crosswindKt;
  });
}

export function runwayRiskText(runways: RunwayWindComponent[]) {
  if (!runways.length) return 'Runway data unavailable.';
  const best = runways[0];
  return `Best aligned runway ${best.runway}: ${best.headwindKt >= 0 ? `${best.headwindKt} kt headwind` : `${Math.abs(best.headwindKt)} kt tailwind`}, ${best.crosswindKt} kt ${best.crosswindDirection} crosswind.`;
}

export function extractWindInfo(metar: any) {
  const wind = metar?.wind;
  return {
    direction: numberOrNull(wind?.degrees),
    speedKt: numberOrNull(wind?.speed?.kts) ?? numberOrNull(wind?.speed_kts),
    gustKt: numberOrNull(wind?.gust?.kts) ?? numberOrNull(wind?.gust_kts)
  };
}

function identToHeading(ident?: string) {
  if (!ident) return null;
  const match = ident.match(/^(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 10;
}

function normalizeSignedDegrees(value: number) {
  let v = ((value + 540) % 360) - 180;
  if (v < -180) v += 360;
  return v;
}

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

function toDeg(v: number) {
  return (v * 180) / Math.PI;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
