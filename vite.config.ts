import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port and must not clear the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'safari15',
    // Source maps help in development, but are not shipped inside the app (they were 5 MB).
    sourcemap: process.env.TAURI_ENV_PLATFORM ? process.env.TAURI_ENV_DEBUG === 'true' : true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
