import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'DumbAI — learn by teaching', description: 'If you can teach it, you understand it.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
