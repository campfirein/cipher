import express, {type Express} from 'express'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

interface WebUiConfig {
  daemonPort: number
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
 * Mounted on the WebUI server (stable port) so the browser
 * can load the app and discover the daemon's transport port.
 *
 * Routes:
 * - GET /api/ui/config → { daemonPort, port, version, projectCwd }
 * - GET /*             → static files from dist/webui/ (SPA fallback)
 */
export function createWebUiMiddleware({getConfig, webuiDistDir}: CreateWebUiMiddlewareOptions): Express {
  const app = express()

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' ws: wss:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      ].join('; '),
    )
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })

  // Config endpoint for browser to bootstrap Socket.IO connection
  app.get('/api/ui/config', (_req, res) => {
    res.json(getConfig())
  })

  // Serve static files from dist/webui/
  if (existsSync(webuiDistDir)) {
    app.use(express.static(webuiDistDir))

    // SPA fallback: serve index.html for unmatched routes
    app.get('*splat', (_req, res) => {
      res.sendFile(join(webuiDistDir, 'index.html'))
    })
  }

  return app
}
