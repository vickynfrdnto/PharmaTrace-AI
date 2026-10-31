import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: /api diteruskan ke backend FastAPI lokal.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Only allow the public hostname used by the Cloudflare Tunnel.
    allowedHosts: ['app.pharmatrace.my.id'],
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8001', changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
