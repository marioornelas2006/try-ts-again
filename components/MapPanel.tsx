'use client';

import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { BriefingResponse } from '@/lib/types';

const defaultCenter: [number, number] = [
  Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LAT ?? 39.8283),
  Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LON ?? -98.5795)
];

export default function MapPanel({ briefing }: { briefing: BriefingResponse | null }) {
  const lineCoords = briefing?.routeGeometry?.geometry?.coordinates ?? [];
  const center: [number, number] = lineCoords.length
    ? [lineCoords[Math.floor(lineCoords.length / 2)][1], lineCoords[Math.floor(lineCoords.length / 2)][0]]
    : defaultCenter;

  return (
    <div className="mapShell">
      <MapContainer center={center} zoom={6} scrollWheelZoom className="mapCanvas">
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay checked name="Radar">
            <TileLayer
              opacity={0.65}
              attribution="NOAA"
              url="https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.Overlay>

          {briefing && (
            <>
              <LayersControl.Overlay checked name="Route">
                <GeoJSON data={briefing.routeGeometry as any} style={{ weight: 4 }} />
              </LayersControl.Overlay>

              <LayersControl.Overlay checked name="SIGMETs">
                <GeoJSON data={briefing.advisories.sigmets as any} />
              </LayersControl.Overlay>

              <LayersControl.Overlay checked name="Convective SIGMETs">
                <GeoJSON data={briefing.advisories.convectiveSigmets as any} />
              </LayersControl.Overlay>

              <LayersControl.Overlay checked name="G-AIRMETs">
                <GeoJSON data={briefing.advisories.gairmets as any} />
              </LayersControl.Overlay>

              <LayersControl.Overlay checked name="CWAs">
                <GeoJSON data={briefing.advisories.cwas as any} />
              </LayersControl.Overlay>
            </>
          )}
        </LayersControl>

        {briefing?.departure.latitude != null && briefing?.departure.longitude != null && (
          <CircleMarker center={[briefing.departure.latitude, briefing.departure.longitude]} radius={8}>
            <Popup>
              {briefing.departure.icao} {briefing.departure.name}
            </Popup>
          </CircleMarker>
        )}

        {briefing?.arrival.latitude != null && briefing?.arrival.longitude != null && (
          <CircleMarker center={[briefing.arrival.latitude, briefing.arrival.longitude]} radius={8}>
            <Popup>
              {briefing.arrival.icao} {briefing.arrival.name}
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
