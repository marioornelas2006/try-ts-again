# GA Route Briefing

Next.js app designed for AWS Amplify Hosting that builds a concise general-aviation cross-country route briefing.

## Features

- Route input, cruise altitude, VFR/IFR, and corridor radius
- CheckWX-powered decoded METAR and TAF lookup
- Corridor airport METAR sampling along the route
- Interactive map with route, radar, SIGMETs, convective SIGMETs, G-AIRMETs, and CWAs
- Current and +6 hour prog chart display
- Runway wind component analysis for departure and arrival airports using OurAirports runway data
- Optional Leidos briefing upload, including PDF upload passed to Gemini
- Gemini-generated route summary with GO / CAUTION / NO_GO output

## Deploy to AWS Amplify

1. Push this project to GitHub.
2. In AWS Amplify Hosting, connect the repository and select the branch.
3. Set environment variables:
   - `CHECKWX_API_KEY`
   - `GEMINI_API_KEY`
4. Amplify should detect the included `amplify.yml` and build the app.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Notes

- The route parser in this version expects a simple airport-to-airport route such as `KLAF KIND`.
- Advisory data is loaded from AviationWeather.gov GeoJSON services.
- This app is for informational planning support and should not replace official flight briefings or pilot judgment.
