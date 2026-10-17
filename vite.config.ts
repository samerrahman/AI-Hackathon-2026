import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], optimizeDeps: { exclude: ['pdfjs-dist'] }, build: { rollupOptions: { output: { manualChunks: { pdf: ['pdfjs-dist'], math: ['katex'] } } } }, server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } } });
