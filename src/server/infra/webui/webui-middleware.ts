import express, {type Express} from 'express'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

interface WebUiConfig {
  port: number
  projectCwd: string
  version: string
}

interface CreateWebUiMiddlewareOptions {
  getConfig: () => WebUiConfig
  webuiDistDir: string
}

/**
 * Creates an Express app that serves the web UI and config endpoint.
 *
 * Mounted on the daemon's HTTP server so the browser can access
 * both the web UI and Socket.IO on the same host:port.
 *
 * Routes:
 * - GET /api/ui/config → { port, version, projectCwd }
 * - GET /ui/*          → static files from dist/ui/ (SPA fallback)
 * - GET /              → redirect to /ui
 */
export function createWebUiMiddleware({getConfig, webuiDistDir}: CreateWebUiMiddlewareOptions): Express {
  const app = express()

  // Config endpoint for browser to bootstrap Socket.IO connection
  app.get('/api/ui/config', (_req, res) => {
    res.json(getConfig())
  })

  // Serve static files from dist/ui/
  if (existsSync(webuiDistDir)) {
    app.use('/ui', express.static(webuiDistDir))

    // SPA fallback: serve index.html for unmatched /ui/* routes
    app.get('/ui/*splat', (_req, res) => {
      res.sendFile(join(webuiDistDir, 'index.html'))
    })
  }

  // Redirect root to /ui
  app.get('/', (_req, res) => {
    res.redirect('/ui')
  })

  return app
}
