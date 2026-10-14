import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production pages get a strict Content Security Policy: only Morph's own scripts and assets, no
// network. (Not in dev: the Vite dev server injects an inline React refresh script.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const csp = () => ({
  name: 'morph-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  server: { port: 5174, strictPort: true },
});
