import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// API_URL lets the e2e run point its own Vite at its own API process (see playwright.config.ts).
export default defineConfig({ plugins: [react()], optimizeDeps: { exclude: ['pdfjs-dist'] }, build: { rollupOptions: { output: { manualChunks: { pdf: ['pdfjs-dist'], math: ['katex'] } } } }, server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:3001' } } });
