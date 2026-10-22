import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// The site lives in web/; the build still goes to the repo's dist/ (Vercel and server/index.ts serve it), and
// env files still come from the repo root.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// API_URL lets the e2e run point its own Vite at its own API process (see playwright.config.ts).
export default defineConfig({ root: here('.'), envDir: here('..'), plugins: [react()], optimizeDeps: { exclude: ['pdfjs-dist'] }, build: { outDir: here('../dist'), emptyOutDir: true, rollupOptions: { output: { manualChunks: { pdf: ['pdfjs-dist'], math: ['katex'] } } } }, server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:3001' } } });
