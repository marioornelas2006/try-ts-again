import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GA Route Briefing',
  description: 'Concise route weather briefing for general aviation pilots.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
