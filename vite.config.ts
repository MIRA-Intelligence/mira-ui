import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version?: string }

// Dev gateway port — keep separate from MIRA.app bundled engine on 18790.
const DEV_GATEWAY_PORT = Number(process.env.VITE_DEV_GATEWAY_PORT || 18790)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? 'dev'),
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${DEV_GATEWAY_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${DEV_GATEWAY_PORT}`,
        ws: true,
      },
    },
  },
})
