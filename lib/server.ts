import Papa from 'papaparse';
import { BriefingResponse, CorridorMetar, LatLon, LayerCollection } from './types';
import {
  buildLineString,
  computeRunwayWindComponents,
  dedupeByIcao,
  extractWindInfo,
  haversineMiles,
  parseRouteInput,
  runwayRiskText,
  sampleGreatCircle
} from './utils';

const CHECKWX_BASE = 'https://api.checkwx.com/v2';
const AWC_BASE = 'https://aviationweather.gov/api/data';
const NOAA_RADAR_TILE = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer';
const OURAIRPORTS_RUNWAYS = 'https://ourairports.com/data/runways.csv';
const OURAIRPORTS_AIRPORTS = 'https://ourairports.com/data/airports.csv';

let runwayCache: Promise<Record<string, any[]> | null> | null = null;
let airportCache: Promise<Record<string, any> | null> | null = null;

export async function buildBriefing(input: {
  route: string;
  altitudeFt: number;
  flightRules: 'VFR' | 'IFR';
  corridorMiles: number;
  uploadedFile?: File | null;
}): Promise<BriefingResponse> {
  const { departure, arrival, waypoints, raw } = parseRouteInput(input.route);

  const [depMetar, arrMetar, depTaf, arrTaf] = await Promise.all([
    getMetar(departure),
    getMetar(arrival),
    getTaf(departure),
    getTaf(arrival)
  ]);

  const depStation = extractStation(depMetar, departure);
  const arrStation = extractStation(arrMetar, arrival);

  if (!depStation || !arrStation) {
    throw new Error('Unable to resolve departure or arrival station coordinates from CheckWX.');
  }

  const routePoints = sampleGreatCircle(depStation, arrStation, 8);
  const routeGeometry = buildLineString(routePoints);

  const [layers, corridorMetars, depRunways, arrRunways, uploadedBriefingContext] = await Promise.all([
    getAdvisoryLayers(),
    getCorridorMetars(routePoints, input.corridorMiles, new Set([departure, arrival])),
    getRunwaysForAirport(departure),
    getRunwaysForAirport(arrival),
    normalizeUploadedBriefing(input.uploadedFile)
  ]);

  const depWind = extractWindInfo(depMetar);
  const arrWind = extractWindInfo(arrMetar);

  const departureSummary = {
    icao: departure,
    name: depMetar?.station?.name,
    location: depMetar?.station?.location,
    latitude: depStation.lat,
    longitude: depStation.lon,
    metar: depMetar,
    taf: arrOrFirst(depTaf),
    runways: computeRunwayWindComponents(depRunways, depWind.direction ?? undefined, depWind.speedKt ?? undefined)
  };

  const arrivalSummary = {
    icao: arrival,
    name: arrMetar?.station?.name,
    location: arrMetar?.station?.location,
    latitude: arrStation.lat,
    longitude: arrStation.lon,
    metar: arrMetar,
    taf: arrOrFirst(arrTaf),
    runways: computeRunwayWindComponents(arrRunways, arrWind.direction ?? undefined, arrWind.speedKt ?? undefined)
  };

  const advisorySubset = filterLayersNearRoute(layers, routePoints, input.corridorMiles + 50);

  const aiBriefing = await getAiBriefing({
    rawRoute: raw,
    departure: departureSummary,
    arrival: arrivalSummary,
    corridorMetars,
    advisories: advisorySubset,
    altitudeFt: input.altitudeFt,
    flightRules: input.flightRules,
    corridorMiles: input.corridorMiles,
    uploadedFile: input.uploadedFile,
    uploadedBriefingContext,
    routeWaypoints: waypoints,
    routeSummary: `${departure} to ${arrival} at ${input.altitudeFt} ft ${input.flightRules}. ${runwayRiskText(departureSummary.runways)} ${runwayRiskText(arrivalSummary.runways)}`
  });

  return {
    generatedAt: new Date().toISOString(),
    route: {
      raw,
      departure,
      arrival,
      waypoints,
      altitudeFt: input.altitudeFt,
      flightRules: input.flightRules,
      corridorMiles: input.corridorMiles
    },
    routeGeometry,
    departure: departureSummary,
    arrival: arrivalSummary,
    corridorMetars,
    advisories: advisorySubset,
    progCharts: {
      current: 'https://aviationweather.gov/data/products/progs/F000_low_sfc.gif',
      plus6: 'https://aviationweather.gov/data/products/progs/F006_low_sfc.gif'
    },
    aiBriefing
  };
}

async function getMetar(icao: string) {
  const json = await checkWx(`/metar/${icao}/decoded`);
  return arrOrFirst(json);
}

async function getTaf(icao: string) {
  const json = await checkWx(`/taf/${icao}/decoded`);
  return arrOrFirst(json);
}

async function getCorridorMetars(points: LatLon[], radiusMiles: number, exclusions: Set<string>): Promise<CorridorMetar[]> {
  const samples = points.slice(1, -1);
  const batches = await Promise.all(
    samples.map(async (point) => {
      const json = await checkWx(`/metar/lat/${point.lat.toFixed(4)}/lon/${point.lon.toFixed(4)}/radius/${Math.min(radiusMiles, 250)}/decoded`);
      const items = Array.isArray(json?.data) ? json.data : [];
      return items.map((metar: any) => ({
        icao: metar?.icao,
        name: metar?.station?.name,
        location: metar?.station?.location,
        distanceMiles: metar?.position?.distance?.miles,
        bearing: metar?.position?.bearing,
        flightCategory: metar?.flight_category,
        metar
      } satisfies CorridorMetar));
    })
  );

  return dedupeByIcao(
    batches
      .flat()
      .filter((item) => item.icao && !exclusions.has(item.icao))
      .sort((a, b) => (a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999))
  ).slice(0, 24);
}

async function getAdvisoryLayers(): Promise<LayerCollection> {
  const [sigmets, gairmets, cwas, convectiveSigmets] = await Promise.all([
    awcGeoJson('airsigmet'),
    awcGeoJson('gairmet'),
    awcGeoJson('cwa'),
    awcGeoJson('airsigmet?hazard=convective')
  ]);

  return {
    sigmets,
    gairmets,
    cwas,
    convectiveSigmets
  };
}

async function awcGeoJson(path: string): Promise<GeoJSON.FeatureCollection> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${AWC_BASE}/${path}${separator}format=geojson`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return emptyCollection();
  const json = await res.json();
  return isFeatureCollection(json) ? json : emptyCollection();
}

async function getRunwaysForAirport(icao: string) {
  const [runwaysByIcao, airportsByIcao] = await Promise.all([loadRunwayCache(), loadAirportCache()]);
  if (!runwaysByIcao) return [];
  if (runwaysByIcao[icao]) return runwaysByIcao[icao];
  const airportRow = airportsByIcao?.[icao];
  if (!airportRow?.gps_code) return [];
  return runwaysByIcao[airportRow.gps_code] ?? [];
}

async function loadRunwayCache() {
  if (!runwayCache) {
    runwayCache = (async () => {
      const res = await fetch(OURAIRPORTS_RUNWAYS, { next: { revalidate: 86400 } });
      if (!res.ok) return null;
      const text = await res.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const map: Record<string, any[]> = {};
      for (const row of parsed.data) {
        const airportIdent = row.airport_ident?.toUpperCase();
        if (!airportIdent) continue;
        map[airportIdent] ??= [];
        map[airportIdent].push(row);
      }
      return map;
    })();
  }
  return runwayCache;
}

async function loadAirportCache() {
  if (!airportCache) {
    airportCache = (async () => {
      const res = await fetch(OURAIRPORTS_AIRPORTS, { next: { revalidate: 86400 } });
      if (!res.ok) return null;
      const text = await res.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const map: Record<string, any> = {};
      for (const row of parsed.data) {
        const ident = row.ident?.toUpperCase();
        if (!ident) continue;
        map[ident] = row;
      }
      return map;
    })();
  }
  return airportCache;
}

async function normalizeUploadedBriefing(file?: File | null) {
  if (!file) return '';
  if (file.type === 'application/pdf') {
    return `Leidos briefing attached as PDF: ${file.name}`;
  }
  const text = await file.text();
  return text.slice(0, 15000);
}

async function getAiBriefing(payload: {
  rawRoute: string;
  routeWaypoints: string[];
  altitudeFt: number;
  flightRules: 'VFR' | 'IFR';
  corridorMiles: number;
  departure: any;
  arrival: any;
  corridorMetars: CorridorMetar[];
  advisories: LayerCollection;
  routeSummary: string;
  uploadedFile?: File | null;
  uploadedBriefingContext?: string;
}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return fallbackAiBriefing(payload);
  }

  const textPrompt = [
    'You are generating a concise U.S. general aviation preflight route briefing.',
    'This is informational software and not a replacement for an official briefing.',
    'Return strict JSON matching the requested schema.',
    `Route: ${payload.rawRoute}`,
    `Waypoints: ${payload.routeWaypoints.join(' -> ')}`,
    `Cruise altitude (ft MSL): ${payload.altitudeFt}`,
    `Flight rules: ${payload.flightRules}`,
    `Corridor radius (miles): ${payload.corridorMiles}`,
    `Summary: ${payload.routeSummary}`,
    `Departure weather JSON: ${JSON.stringify(trimForModel(payload.departure))}`,
    `Arrival weather JSON: ${JSON.stringify(trimForModel(payload.arrival))}`,
    `Corridor METARs JSON: ${JSON.stringify(trimForModel(payload.corridorMetars))}`,
    `Advisories JSON: ${JSON.stringify(summarizeAdvisories(payload.advisories))}`,
    payload.uploadedBriefingContext ? `Supplemental user weather briefing: ${payload.uploadedBriefingContext}` : 'No supplemental uploaded briefing text provided.'
  ].join('\n\n');

  const contents: any[] = [{ parts: [] as any[] }];
  if (payload.uploadedFile?.type === 'application/pdf') {
    const bytes = Buffer.from(await payload.uploadedFile.arrayBuffer()).toString('base64');
    contents[0].parts.push({ inline_data: { mime_type: 'application/pdf', data: bytes } });
  }
  contents[0].parts.push({ text: textPrompt });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            decision: { type: 'STRING', enum: ['GO', 'NO_GO', 'CAUTION'] },
            confidence: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            summary: { type: 'STRING' },
            hazards: { type: 'ARRAY', items: { type: 'STRING' } },
            recommendations: { type: 'ARRAY', items: { type: 'STRING' } },
            departureAssessment: { type: 'STRING' },
            arrivalAssessment: { type: 'STRING' },
            enrouteAssessment: { type: 'STRING' },
            uploadedBriefingNotes: { type: 'STRING' }
          },
          required: ['decision', 'confidence', 'summary', 'hazards', 'recommendations', 'departureAssessment', 'arrivalAssessment', 'enrouteAssessment']
        }
      }
    })
  });

  if (!res.ok) {
    return fallbackAiBriefing(payload);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return fallbackAiBriefing(payload);
  }
}

function fallbackAiBriefing(payload: {
  departure: any;
  arrival: any;
  advisories: LayerCollection;
  corridorMetars: CorridorMetar[];
  flightRules: 'VFR' | 'IFR';
}) {
  const depCat = payload.departure?.metar?.flight_category || 'UNKNOWN';
  const arrCat = payload.arrival?.metar?.flight_category || 'UNKNOWN';
  const worstCorridor = payload.corridorMetars.find((m) => ['LIFR', 'IFR'].includes(m.flightCategory || ''));
  const hazardCount =
    payload.advisories.sigmets.features.length +
    payload.advisories.convectiveSigmets.features.length +
    payload.advisories.gairmets.features.length +
    payload.advisories.cwas.features.length;

  let decision: 'GO' | 'NO_GO' | 'CAUTION' = 'GO';
  if (payload.flightRules === 'VFR' && [depCat, arrCat].some((cat) => ['IFR', 'LIFR'].includes(cat))) {
    decision = 'NO_GO';
  } else if (worstCorridor || hazardCount > 0 || [depCat, arrCat].some((cat) => ['MVFR', 'IFR', 'LIFR'].includes(cat))) {
    decision = 'CAUTION';
  }

  return {
    decision,
    confidence: 'LOW',
    summary: `Automated fallback briefing based on station categories and advisory counts. Departure ${depCat}. Arrival ${arrCat}. ${hazardCount} advisory layers intersect the route corridor.`,
    hazards: [
      hazardCount > 0 ? `${hazardCount} advisory features detected near the route.` : 'No advisory intersections detected from the loaded layers.',
      worstCorridor ? `At least one corridor airport is reporting ${worstCorridor.flightCategory}.` : 'No IFR/LIFR corridor METAR was identified in sampled stations.'
    ],
    recommendations: [
      'Cross-check with an official weather briefing before flight.',
      'Review winds aloft, freezing level, and route alternatives before departure.',
      'Validate runway wind components against current airport operations.'
    ],
    departureAssessment: `Departure field category: ${depCat}. ${runwayRiskText(payload.departure?.runways ?? [])}`,
    arrivalAssessment: `Arrival field category: ${arrCat}. ${runwayRiskText(payload.arrival?.runways ?? [])}`,
    enrouteAssessment: worstCorridor
      ? `Sampled enroute concern: ${worstCorridor.icao} is reporting ${worstCorridor.flightCategory}.`
      : 'No sampled enroute airport reported IFR/LIFR in the corridor set.'
  };
}

async function checkWx(path: string) {
  const key = process.env.CHECKWX_API_KEY;
  if (!key) {
    throw new Error('Missing CHECKWX_API_KEY environment variable.');
  }
  const res = await fetch(`${CHECKWX_BASE}${path}`, {
    headers: { 'X-API-Key': key },
    next: { revalidate: 300 }
  });
  if (!res.ok) {
    throw new Error(`CheckWX request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function extractStation(metar: any, fallbackIcao: string): LatLon | null {
  const coords = metar?.station?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    return { lon: Number(coords[0]), lat: Number(coords[1]) };
  }
  const station = metar?.station;
  if (station?.longitude != null && station?.latitude != null) {
    return { lon: Number(station.longitude), lat: Number(station.latitude) };
  }
  const position = metar?.position?.coordinates;
  if (Array.isArray(position) && position.length >= 2) {
    return { lon: Number(position[0]), lat: Number(position[1]) };
  }
  console.warn(`No coordinates found for ${fallbackIcao}`);
  return null;
}

function arrOrFirst(json: any) {
  if (Array.isArray(json?.data)) return json.data[0];
  return json?.data ?? json;
}

function trimForModel(value: any) {
  const text = JSON.stringify(value);
  if (text.length <= 12000) return value;
  return { truncated: true, textSnippet: text.slice(0, 12000) };
}

function summarizeAdvisories(advisories: LayerCollection) {
  const summarize = (fc: GeoJSON.FeatureCollection) =>
    fc.features.slice(0, 20).map((f) => ({
      id: (f.properties as any)?.id ?? (f.properties as any)?.airSigmetId ?? null,
      type: (f.properties as any)?.hazard ?? (f.properties as any)?.phenomenon ?? (f.properties as any)?.type ?? null,
      raw: (f.properties as any)?.rawText ?? (f.properties as any)?.raw_text ?? null,
      start: (f.properties as any)?.issueTime ?? (f.properties as any)?.startTime ?? null,
      end: (f.properties as any)?.endTime ?? null
    }));

  return {
    sigmets: summarize(advisories.sigmets),
    convectiveSigmets: summarize(advisories.convectiveSigmets),
    gairmets: summarize(advisories.gairmets),
    cwas: summarize(advisories.cwas)
  };
}

function filterLayersNearRoute(layers: LayerCollection, routePoints: LatLon[], corridorMiles: number): LayerCollection {
  const filterCollection = (fc: GeoJSON.FeatureCollection) => ({
    ...fc,
    features: fc.features.filter((feature) => featureNearRoute(feature, routePoints, corridorMiles))
  });

  return {
    sigmets: filterCollection(layers.sigmets),
    gairmets: filterCollection(layers.gairmets),
    cwas: filterCollection(layers.cwas),
    convectiveSigmets: filterCollection(layers.convectiveSigmets)
  };
}

function featureNearRoute(feature: GeoJSON.Feature, routePoints: LatLon[], corridorMiles: number) {
  const coords = extractCoordinates(feature.geometry);
  if (!coords.length) return false;
  return coords.some(([lon, lat]) => routePoints.some((p) => haversineMiles(p, { lat, lon }) <= corridorMiles));
}

function extractCoordinates(geometry: GeoJSON.Geometry | null): Array<[number, number]> {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates as [number, number]];
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates as Array<[number, number]>;
    case 'MultiLineString':
    case 'Polygon':
      return (geometry.coordinates as Array<Array<[number, number]>>).flat();
    case 'MultiPolygon':
      return (geometry.coordinates as Array<Array<Array<[number, number]>>>).flat(2);
    case 'GeometryCollection':
      return geometry.geometries.flatMap((g) => extractCoordinates(g));
    default:
      return [];
  }
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function isFeatureCollection(value: any): value is GeoJSON.FeatureCollection {
  return value?.type === 'FeatureCollection' && Array.isArray(value?.features);
}

export const radarTileInfo = {
  title: 'NOAA base reflectivity',
  mapServer: NOAA_RADAR_TILE,
  tileUrl: `${NOAA_RADAR_TILE}/tile/{z}/{y}/{x}`
};
