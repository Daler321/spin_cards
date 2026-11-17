import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const BASE = '/admin/';
const PORT = 5174;

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: { conditions: ['@spincards/source', ...defaultClientConditions] },
  server: {
    host: '0.0.0.0',
    port: PORT,
    strictPort: true,
    // Reached through the compose proxy and the HTTPS tunnels (ngrok, cloudflared).
    allowedHosts: [
      'proxy',
      '.ngrok-free.app',
      '.ngrok-free.dev',
      '.ngrok.app',
      '.ngrok.dev',
      '.trycloudflare.com',
    ],
  },
  build: { target: 'es2022', sourcemap: true },
});
