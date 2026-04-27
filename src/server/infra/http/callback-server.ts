 
import type {Server} from 'node:http'
import type {Socket} from 'node:net'

import express from 'express'

import {AuthenticationError} from '../../core/domain/errors/auth-error.js'

type CallbackResult = {
  code: string
  state: string
}

const PAGE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #000;
    color: #e5e5e5;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 64px 24px 24px;
    position: relative;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(900px 500px at 50% -10%, rgba(23, 178, 106, 0.35), transparent 60%),
      radial-gradient(700px 400px at 95% 10%, rgba(220, 130, 50, 0.18), transparent 60%);
  }
  body::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 55%, transparent 100%);
    mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 55%, transparent 100%);
  }
  .brand { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; margin-bottom: 96px; }
  .brand svg { width: 28px; height: 28px; }
  .brand span { font-weight: 700; letter-spacing: 0.08em; font-size: 18px; color: #fff; }
  .card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 560px;
    background: rgba(20, 22, 26, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 40px 32px;
    text-align: center;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .icon-circle {
    width: 56px; height: 56px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin: 0 auto 20px;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-circle svg { width: 28px; height: 28px; }
  h1 { font-size: 22px; font-weight: 600; color: #fff; margin-bottom: 10px; letter-spacing: -0.01em; }
  p { font-size: 14px; color: #a3a3a3; line-height: 1.5; max-width: 340px; margin: 0 auto; }
  .error-detail {
    margin-top: 20px;
    padding: 12px 14px;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.18);
    border-radius: 8px;
    color: #fca5a5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    text-align: left;
    word-break: break-word;
  }
`

const BRAND_LOGO_SVG = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="16" fill="black"/><path d="M16.01 1.88257C7.97727 1.88257 1.4502 8.42761 1.4502 16.4814C1.4502 24.5352 7.97727 31.0803 16.01 31.0803C24.0427 31.0803 30.5698 24.5352 30.5698 16.4814C30.5698 8.42761 24.0427 1.88257 16.01 1.88257ZM16.01 2.51825C23.7077 2.51825 29.9365 8.76029 29.9365 16.4814C29.9365 24.1994 23.7077 30.4446 16.01 30.4446C8.30917 30.4446 2.08354 24.1994 2.08354 16.4814C2.08354 8.7595 8.30839 2.51825 16.01 2.51825Z" fill="white"/><path d="M29.2815 12.0991L29.1269 11.6188C28.9465 11.1643 28.7091 10.5575 28.5076 10.1132C25.829 5.39161 14.5601 3.45957 9.52303 3.78834C16.6663 3.90392 27.6361 7.1206 29.2815 12.0983M29.1699 20.8487C29.3393 20.2638 29.5439 19.4766 29.6736 18.8846L29.7423 18.477C30.1812 12.3435 15.3879 8.24593 5.58008 8.58564C18.268 9.40875 31.0488 14.8277 29.1699 20.8487Z" fill="white"/><path d="M23.6739 28.1234C24.1828 27.748 24.6799 27.3568 25.1647 26.9505C25.4349 26.6904 25.798 26.3476 26.0542 26.0735C30.9545 20.3008 15.6279 15.4886 3.76074 15.644C21.5575 17.2864 29.4309 23.651 24.0807 27.8274C23.9581 27.9212 23.7965 28.0328 23.6739 28.1234Z" fill="white"/><path d="M15.606 30.0481C17.6653 31.0766 21.4888 30.0192 21.6942 27.9794C21.9823 25.1891 13.3123 22.4269 5.12891 22.7049C16.6969 23.5421 22.144 27.3007 19.5731 29.3077" fill="white"/></svg>`

const USER_ICON_SVG = `<svg viewBox="0 0 24 24" fill="#17b26a" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`

const ALERT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="#f87171" aria-hidden="true"><path d="M12 2 1 21h22L12 2zm0 5.5L19.5 19h-15L12 7.5zM11 11v4h2v-4h-2zm0 5v2h2v-2h-2z"/></svg>`

/**
 * Escape characters that have meaning in HTML so user-controlled error
 * messages cannot break out of attribute or text contexts.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Express parses repeated query keys (e.g. `?error=foo&error=bar`) into
 * arrays, and nested syntax (`?error[code]=x`) into objects. Authoritative
 * OAuth providers always send a single string per key, but the wire is
 * untrusted — coerce any non-string shape to undefined and pick the first
 * string when given an array, so we never feed `[object Object]` or a
 * comma-joined value into a user-facing message.
 */
export function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    if (typeof first === 'string') return first
  }

  return undefined
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ByteRover - Authentication Successful</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="brand">${BRAND_LOGO_SVG}<span>BYTEROVER</span></div>
<div class="card">
  <div class="icon-circle">${USER_ICON_SVG}</div>
  <h1>Authentication Successful</h1>
  <p>You can now safely close this tab and return to where you left off</p>
</div>
<!-- inline script: would be blocked by a strict CSP if one is added later --><script>setTimeout(() => window.close(), 2500);</script>
</body>
</html>`

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ByteRover - Authentication Failed</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="brand">${BRAND_LOGO_SVG}<span>BYTEROVER</span></div>
<div class="card">
  <div class="icon-circle">${ALERT_ICON_SVG}</div>
  <h1>Authentication Failed</h1>
  <p>An error occurred while signing you in. Return to the CLI and try again.</p>
  <div class="error-detail">${escapeHtml(message)}</div>
</div>
</body>
</html>`
}

export class CallbackServer {
  private app = express()
  private connections = new Set<Socket>()
  private server: Server | undefined = undefined

  public constructor() {
    this.setupRoutes()
  }

  public getAddress(): undefined | {port: number} {
    const address = this.server?.address()
    if (address !== null && address !== undefined && typeof address !== 'string') {
      return {port: address.port}
    }

    return undefined
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Listen on port 0 to get a random available port
      this.server = this.app.listen(0, () => {
        const address = this.server?.address()
        if (address !== null && address !== undefined && typeof address !== 'string') {
          resolve(address.port)
        } else {
          reject(new Error('Failed to start server'))
        }
      })

      // Track connections to allow force-closing during shutdown
      this.server.on('connection', (conn: Socket) => {
        this.connections.add(conn)
        conn.on('close', () => {
          this.connections.delete(conn)
        })
      })
    })
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server === undefined) {
        resolve()
      } else {
        // Force close all active connections to prevent delays
        for (const conn of this.connections) {
          conn.destroy()
        }

        this.connections.clear()

        this.server.close(() => {
          this.server = undefined
          resolve()
        })
      }
    })
  }

  public waitForCallback(expectedState: string, timeoutMs: number): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new AuthenticationError('Authentication timeout - no callback received'))
      }, timeoutMs)

      this.app.locals.onCallback = (code: string, state: string) => {
        clearTimeout(timeout)

        if (state !== expectedState) {
          reject(new AuthenticationError('State mismatch - possible CSRF attack'))
          return
        }

        resolve({code, state})
      }

      this.app.locals.onError = (error: string) => {
        clearTimeout(timeout)
        reject(new AuthenticationError(error))
      }
    })
  }

  private setupRoutes(): void {
    this.app.get('/callback', (req, res) => {
      const error = firstQueryParam(req.query.error)
      const errorDescription = firstQueryParam(req.query.error_description)
      const code = firstQueryParam(req.query.code)
      const state = firstQueryParam(req.query.state)

      if (error !== undefined) {
        const errorMessage = errorDescription ?? error
        this.app.locals.onError?.(errorMessage)
        res.status(400).type('html').send(errorHtml(errorMessage))
        return
      }

      if (code === undefined || state === undefined) {
        const missingMessage = 'Missing code or state parameter'
        this.app.locals.onError?.(missingMessage)
        res.status(400).type('html').send(errorHtml(missingMessage))
        return
      }

      this.app.locals.onCallback?.(code, state)
      res.status(200).type('html').send(SUCCESS_HTML)
    })
  }
}
