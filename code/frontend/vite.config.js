import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Single source of truth for the app version: package.json "version".
  // Exposed to the client bundle so the sidebar can display it.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
