import type { ProxyOptions } from 'vite'

import { discoverDaemon } from '@campfirein/brv-transport-client'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The shared package is linked from a sibling workspace and still uses the
// monorepo-only `@workspace/ui/*` alias internally, so we point that alias at
// the package's real source directory here.
const currentDir = dirname(fileURLToPath(import.meta.url))
const brvPkgSrc = realpathSync(resolve(currentDir, '../../node_modules/@campfirein/byterover-packages/src'))

export default defineConfig(({ command }) => {
  let proxy: Record<string, ProxyOptions | string> | undefined

  if (command === 'serve') {
    try {
      const status = discoverDaemon()
      if (status.running) {
        const target = `http://localhost:${status.port}`
        proxy = {
          '/api': { target },
          '/socket.io': { target, ws: true },
        }
        console.log(`\n  Daemon found on port ${status.port} — proxying /api and /socket.io to ${target}\n`)
      } else {
        console.log('\n  Daemon is not running. Make daemon alive before continue.\n')
      }
    } catch {
      console.log('\n  Daemon is not running. Make daemon alive before continue.\n')
    }
  }

  return {
    base: '/ui',
    build: {
      emptyOutDir: true,
      outDir: '../../dist/webui',
    },
    optimizeDeps: {
      exclude: ['@campfirein/byterover-packages'],
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@workspace/ui': brvPkgSrc,
        // Force linked packages (npm link) to use this project's React instance.
        // Without this, npm-linked packages resolve react from their own
        // node_modules, causing "Invalid hook call" due to duplicate React.
        'react': resolve(currentDir, '../../node_modules/react'),
        'react-dom': resolve(currentDir, '../../node_modules/react-dom'),
      },
    },
    server: {
      ...(proxy ? { proxy } : {}),
      watch: {
        ignored: ['!**/node_modules/@campfirein/**'],
      },
    },
  }
})
