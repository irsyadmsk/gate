// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Irsyads Gate — pos satpam di gate.irsyads.com. Statis (tanpa adapter), data
// tamu tersimpan di perangkat sampai penyimpanan server (RLS) disetujui.
export default defineConfig({
  site: process.env.PUBLIC_GATE_ORIGIN || 'https://gate.irsyads.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [react()],
  vite: {
    resolve: {
      alias: [
        { find: /^@irsyads\/supabase\/(.*)$/, replacement: path.resolve(__dirname, './packages/supabase/src') + '/$1' },
        { find: '@irsyads/gate-core', replacement: path.resolve(__dirname, './packages/gate/src/index.ts') },
        { find: '@', replacement: path.resolve(__dirname, './src') },
      ],
    },
  },
});
