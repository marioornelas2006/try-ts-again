import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'aviationweather.gov' },
      { protocol: 'https', hostname: 'mapservices.weather.noaa.gov' },
      { protocol: 'https', hostname: 'tile.openstreetmap.org' }
    ]
  }
};

export default nextConfig;
