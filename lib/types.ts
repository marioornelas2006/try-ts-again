export type LatLon = {
  lat: number;
  lon: number;
};

export type RunwayWindComponent = {
  runway: string;
  heading: number;
  lengthFt?: number | null;
  widthFt?: number | null;
  surface?: string | null;
  headwindKt: number;
  crosswindKt: number;
  crosswindDirection: 'left' | 'right' | 'none';
  favored: boolean;
};

export type AirportWeatherSummary = {
  icao: string;
  name?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  metar?: any;
  taf?: any;
  runways: RunwayWindComponent[];
};

export type CorridorMetar = {
  icao: string;
  name?: string;
  location?: string;
  distanceMiles?: number;
  bearing?: number;
  flightCategory?: string;
  metar: any;
};

export type LayerCollection = {
  sigmets: GeoJSON.FeatureCollection;
  gairmets: GeoJSON.FeatureCollection;
  cwas: GeoJSON.FeatureCollection;
  convectiveSigmets: GeoJSON.FeatureCollection;
};

export type BriefingResponse = {
  generatedAt: string;
  route: {
    raw: string;
    departure: string;
    arrival: string;
    waypoints: string[];
    altitudeFt: number;
    flightRules: 'VFR' | 'IFR';
    corridorMiles: number;
  };
  routeGeometry: GeoJSON.Feature<GeoJSON.LineString>;
  departure: AirportWeatherSummary;
  arrival: AirportWeatherSummary;
  corridorMetars: CorridorMetar[];
  advisories: {
    sigmets: GeoJSON.FeatureCollection;
    gairmets: GeoJSON.FeatureCollection;
    cwas: GeoJSON.FeatureCollection;
    convectiveSigmets: GeoJSON.FeatureCollection;
  };
  progCharts: {
    current: string;
    plus6: string;
  };
  aiBriefing: {
    decision: 'GO' | 'NO_GO' | 'CAUTION';
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    summary: string;
    hazards: string[];
    recommendations: string[];
    departureAssessment: string;
    arrivalAssessment: string;
    enrouteAssessment: string;
    uploadedBriefingNotes?: string;
  };
};
