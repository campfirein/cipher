import {discoverDaemon} from '@campfirein/brv-transport-client'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

export default defineConfig(({command}) => {
  let proxy: Record<string, unknown> | undefined

  if (command === 'serve') {
    try {
      const status = discoverDaemon()
      if (status.running) {
        const target = `http://localhost:${status.port}`
        proxy = {
          '/api': {target},
          '/socket.io': {target, ws: true},
        }
      }
    } catch {
      // No daemon — run without proxy
    }
  }

  return {
    base: '/ui',
    build: {
      emptyOutDir: true,
      outDir: '../../dist/webui',
    },
    plugins: [react()],
    server: proxy ? {proxy} : undefined,
  }
})
