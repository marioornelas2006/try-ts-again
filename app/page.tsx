'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { AlertTriangle, Plane, Wind, CloudRain } from 'lucide-react';
import { BriefingResponse, RunwayWindComponent } from '@/lib/types';

const MapPanel = dynamic(() => import('@/components/MapPanel'), { ssr: false });

const initialForm: {
  route: string;
  altitudeFt: number;
  flightRules: 'VFR' | 'IFR';
  corridorMiles: number;
} = {
  route: 'KLAF KIND',
  altitudeFt: 5500,
  flightRules: 'VFR',
  corridorMiles: 50
};

export default function Page() {
  const [form, setForm] = useState({ ...initialForm });
  const [file, setFile] = useState<File | null>(null);
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const advisoryCounts = useMemo(() => {
    if (!briefing) return null;
    return {
      sigmets: briefing.advisories.sigmets.features.length,
      convective: briefing.advisories.convectiveSigmets.features.length,
      gairmets: briefing.advisories.gairmets.features.length,
      cwas: briefing.advisories.cwas.features.length
    };
  }, [briefing]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const body = new FormData();
      body.set('route', form.route);
      body.set('altitudeFt', String(form.altitudeFt));
      body.set('flightRules', form.flightRules);
      body.set('corridorMiles', String(form.corridorMiles));
      if (file) body.set('uploadedBriefing', file);

      const res = await fetch('/api/briefing', {
        method: 'POST',
        body
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Request failed.');
      }
      setBriefing(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate briefing.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>GA Route Briefing</h1>
        <p>
          Route-focused general aviation weather dashboard using CheckWX weather data, official AWC advisory layers,
          radar, prog charts, and a Gemini-generated go or no-go style summary.
        </p>
      </section>

      <section className="grid">
        <aside className="stack">
          <form className="card formGrid" onSubmit={onSubmit}>
            <h2>Flight Input</h2>
            <label>
              Route
              <input
                value={form.route}
                onChange={(e) => setForm((s) => ({ ...s, route: e.target.value.toUpperCase() }))}
                placeholder="KLAF KIND"
              />
            </label>
            <label>
              Cruise altitude (ft MSL)
              <input
                type="number"
                value={form.altitudeFt}
                onChange={(e) => setForm((s) => ({ ...s, altitudeFt: Number(e.target.value) }))}
              />
            </label>
            <label>
              Flight rules
              <select
                value={form.flightRules}
                onChange={(e) => setForm((s) => ({ ...s, flightRules: e.target.value as 'VFR' | 'IFR' }))}
              >
                <option value="VFR">VFR</option>
                <option value="IFR">IFR</option>
              </select>
            </label>
            <label>
              Corridor distance (miles)
              <input
                type="number"
                min={1}
                max={250}
                value={form.corridorMiles}
                onChange={(e) => setForm((s) => ({ ...s, corridorMiles: Number(e.target.value) }))}
              />
            </label>
            <label>
              Supplemental Leidos briefing
              <input type="file" accept=".pdf,.txt,.md,.html" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <div className="small">Enter simple airport routes like “KLAF KIND” or “KSEE KTRM”.</div>
            <button type="submit" disabled={loading}>{loading ? 'Generating briefing...' : 'Generate briefing'}</button>
            {error ? <div className="error">{error}</div> : null}
          </form>

          <div className="card">
            <h3>Map Layers</h3>
            <ul className="list">
              <li>Radar base reflectivity</li>
              <li>SIGMETs</li>
              <li>Convective SIGMETs</li>
              <li>G-AIRMETs</li>
              <li>Center Weather Advisories</li>
            </ul>
          </div>
        </aside>

        <section className="stack">
          <div className="card">
            <h2>Interactive Map</h2>
            <MapPanel briefing={briefing} />
          </div>

          {briefing ? (
            <>
              <div className="summaryGrid">
                <div className="card">
                  <h2>AI Route Decision</h2>
                  <div className="metrics">
                    <Metric icon={<Plane size={16} />} label="Decision" value={formatDecision(briefing.aiBriefing.decision)} />
                    <Metric icon={<AlertTriangle size={16} />} label="Confidence" value={briefing.aiBriefing.confidence} />
                    <Metric icon={<CloudRain size={16} />} label="Rules" value={briefing.route.flightRules} />
                  </div>
                  <p>{briefing.aiBriefing.summary}</p>
                  <div className="sectionGrid">
                    <div>
                      <h3>Hazards</h3>
                      <ul className="list">
                        {briefing.aiBriefing.hazards.map((item, idx) => <li key={idx}>{item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <h3>Recommendations</h3>
                      <ul className="list">
                        {briefing.aiBriefing.recommendations.map((item, idx) => <li key={idx}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2>Route Snapshot</h2>
                  <div className="metrics">
                    <Metric icon={<Wind size={16} />} label="Altitude" value={`${briefing.route.altitudeFt} ft`} />
                    <Metric icon={<CloudRain size={16} />} label="Corridor" value={`${briefing.route.corridorMiles} mi`} />
                    <Metric icon={<AlertTriangle size={16} />} label="Corridor airports" value={String(briefing.corridorMetars.length)} />
                  </div>
                  {advisoryCounts && (
                    <div className="metrics" style={{ marginTop: 12 }}>
                      <Metric label="SIGMETs" value={String(advisoryCounts.sigmets)} />
                      <Metric label="Convective" value={String(advisoryCounts.convective)} />
                      <Metric label="G-AIRMETs" value={String(advisoryCounts.gairmets)} />
                    </div>
                  )}
                  <p><strong>Departure:</strong> {briefing.departure.icao} {briefing.departure.name ?? ''}</p>
                  <p><strong>Arrival:</strong> {briefing.arrival.icao} {briefing.arrival.name ?? ''}</p>
                  <p><strong>Departure assessment:</strong> {briefing.aiBriefing.departureAssessment}</p>
                  <p><strong>Arrival assessment:</strong> {briefing.aiBriefing.arrivalAssessment}</p>
                  <p><strong>Enroute assessment:</strong> {briefing.aiBriefing.enrouteAssessment}</p>
                </div>
              </div>

              <div className="sectionGrid">
                <AirportCard title="Departure" airport={briefing.departure} />
                <AirportCard title="Arrival" airport={briefing.arrival} />
              </div>

              <div className="card">
                <h2>Corridor METARs</h2>
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>ICAO</th>
                        <th>Category</th>
                        <th>Wind</th>
                        <th>Visibility</th>
                        <th>Ceiling / Sky</th>
                        <th>Raw</th>
                      </tr>
                    </thead>
                    <tbody>
                      {briefing.corridorMetars.map((item) => (
                        <tr key={item.icao}>
                          <td>
                            <strong>{item.icao}</strong>
                            <div className="small">{item.name}</div>
                          </td>
                          <td>{item.flightCategory ?? '—'}</td>
                          <td>{formatWind(item.metar)}</td>
                          <td>{item.metar?.visibility?.text ?? item.metar?.visibility?.miles ?? '—'}</td>
                          <td>{formatSky(item.metar)}</td>
                          <td>{item.metar?.raw_text ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h2>Prog Charts</h2>
                <div className="chartImages">
                  <div>
                    <h3>Current</h3>
                    <img src={briefing.progCharts.current} alt="Current prog chart" />
                  </div>
                  <div>
                    <h3>+6 Hour</h3>
                    <img src={briefing.progCharts.plus6} alt="6 hour prog chart" />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="card">
              <h2>No briefing loaded</h2>
              <p>Submit a route to load METARs, TAFs, advisory overlays, runway wind components, and the AI route summary.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="metric">
      <div className="metricLabel">{icon ? <span style={{ marginRight: 6 }}>{icon}</span> : null}{label}</div>
      <div className="metricValue">{value}</div>
    </div>
  );
}

function AirportCard({ title, airport }: { title: string; airport: BriefingResponse['departure'] }) {
  return (
    <div className="card">
      <h2>{title} Airport</h2>
      <p><strong>{airport.icao}</strong> {airport.name ?? ''}</p>
      <p>{airport.location ?? ''}</p>
      <div className="metrics">
        <Metric label="Category" value={airport.metar?.flight_category ?? '—'} />
        <Metric label="Wind" value={formatWind(airport.metar)} />
        <Metric label="Altimeter" value={String(airport.metar?.pressure?.hg ?? '—')} />
      </div>
      <p><strong>Visibility:</strong> {airport.metar?.visibility?.text ?? airport.metar?.visibility?.miles ?? '—'}</p>
      <p><strong>Sky:</strong> {formatSky(airport.metar)}</p>
      <p><strong>Decoded TAF focus:</strong> {formatTaf(airport.taf)}</p>
      <h3>Runway wind components</h3>
      <RunwayTable runways={airport.runways} />
    </div>
  );
}

function RunwayTable({ runways }: { runways: RunwayWindComponent[] }) {
  if (!runways.length) return <div className="small">Runway data unavailable.</div>;

  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Runway</th>
            <th>Heading</th>
            <th>Headwind</th>
            <th>Crosswind</th>
            <th>Surface</th>
          </tr>
        </thead>
        <tbody>
          {runways.slice(0, 8).map((runway) => (
            <tr key={`${runway.runway}-${runway.heading}`}>
              <td>{runway.runway} {runway.favored ? <span className="badge">favored</span> : null}</td>
              <td>{runway.heading}&deg;</td>
              <td>{runway.headwindKt} kt</td>
              <td>{runway.crosswindKt} kt {runway.crosswindDirection}</td>
              <td>{runway.surface ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatWind(metar: any) {
  const wind = metar?.wind;
  if (!wind) return '—';
  const speed = wind?.speed?.kts ?? wind?.speed_kts ?? '—';
  const gust = wind?.gust?.kts ?? wind?.gust_kts;
  const dir = wind?.degrees ?? wind?.direction ?? 'VRB';
  return `${dir}@${speed}${gust ? `G${gust}` : ''} kt`;
}

function formatSky(metar: any) {
  const clouds = metar?.clouds;
  if (Array.isArray(clouds) && clouds.length) {
    return clouds.map((c: any) => `${c.code ?? ''}${c.feet ? ` ${c.feet} ft` : ''}`.trim()).join(', ');
  }
  return '—';
}

function formatTaf(taf: any) {
  if (!taf) return 'No TAF found.';
  if (taf?.forecast?.[0]) {
    const segment = taf.forecast[0];
    const clouds = Array.isArray(segment.clouds) ? segment.clouds.map((c: any) => c.code).join(', ') : '—';
    return `${segment.wind?.degrees ?? 'VRB'}@${segment.wind?.speed?.kts ?? '—'} kt, vis ${segment.visibility?.text ?? segment.visibility?.meters ?? '—'}, clouds ${clouds}`;
  }
  return taf.raw_text ?? 'TAF available.';
}

function formatDecision(value: string) {
  return value === 'NO_GO' ? 'NO-GO' : value;
}
