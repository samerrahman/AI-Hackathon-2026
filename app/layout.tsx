import type { Metadata } from 'next';
import './globals.css';
import './color-pop.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: 'Teach a Stupid AI — Learn by Teaching',
  description: 'Teach a delightfully confused AI student and discover how well you understand any topic.',
  openGraph: { title: 'Teach a Stupid AI', description: 'The best way to learn is to teach.' },
  twitter: { card: 'summary_large_image', title: 'Teach a Stupid AI', description: 'The best way to learn is to teach.' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
