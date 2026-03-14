import type {IncomingMessage, Server, ServerResponse} from 'node:http'
import type {Socket} from 'node:net'

import http from 'node:http'

import type {ProviderCallbackResult} from './types.js'

import {
  ProviderCallbackOAuthError,
  ProviderCallbackStateError,
  ProviderCallbackTimeoutError,
  ProviderOAuthError,
} from './errors.js'

const DEFAULT_CALLBACK_PATH = '/auth/callback'
const DEFAULT_TIMEOUT_MS = 300_000 // 5 minutes

const SUCCESS_HTML = '<html><body><h1>Authentication successful</h1><p>You can close this window.</p></body></html>'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

type ProviderCallbackServerOptions = {
  callbackPath?: string
  port: number
}

export class ProviderCallbackServer {
  private readonly callbackPath: string
  private readonly connections = new Set<Socket>()
  private isStopping = false
  private onCallback: ((code: string, state: string) => void) | undefined
  private onError: ((error: Error) => void) | undefined
  private pendingTimeout: ReturnType<typeof setTimeout> | undefined
  private readonly port: number
  private server: Server | undefined = undefined

  public constructor(options: ProviderCallbackServerOptions) {
    this.port = options.port
    this.callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH
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
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.on('connection', (conn: Socket) => {
        this.connections.add(conn)
        conn.on('close', () => {
          this.connections.delete(conn)
        })
      })

      this.server.on('error', reject)

      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server?.address()
        if (address !== null && address !== undefined && typeof address !== 'string') {
          resolve(address.port)
        } else {
          reject(new Error('Failed to start provider callback server'))
        }
      })
    })
  }

  public async stop(): Promise<void> {
    if (this.isStopping) return

    this.isStopping = true

    // Reject any pending waitForCallback promise so consumers don't hang
    this.onError?.(new ProviderOAuthError('Callback server was stopped'))
    this.onCallback = undefined
    this.onError = undefined

    if (this.pendingTimeout !== undefined) {
      clearTimeout(this.pendingTimeout)
      this.pendingTimeout = undefined
    }

    return new Promise((resolve) => {
      if (this.server === undefined) {
        this.isStopping = false
        resolve()
        return
      }

      for (const conn of this.connections) {
        conn.destroy()
      }

      this.connections.clear()

      this.server.close(() => {
        this.server = undefined
        this.isStopping = false
        resolve()
      })
    })
  }

  public waitForCallback(expectedState: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProviderCallbackResult> {
    if (this.onCallback !== undefined) {
      return Promise.reject(new ProviderOAuthError('A callback is already pending'))
    }

    const promise = new Promise<ProviderCallbackResult>((resolve, reject) => {
      let settled = false

      this.pendingTimeout = setTimeout(() => {
        if (!settled) {
          settled = true
          this.pendingTimeout = undefined
          reject(new ProviderCallbackTimeoutError(timeoutMs))
        }
      }, timeoutMs)

      this.onCallback = (code: string, state: string) => {
        if (settled) return
        clearTimeout(this.pendingTimeout)
        this.pendingTimeout = undefined

        if (state !== expectedState) {
          settled = true
          reject(new ProviderCallbackStateError())
          return
        }

        settled = true
        resolve({code, state})
      }

      this.onError = (error: Error) => {
        if (settled) return
        clearTimeout(this.pendingTimeout)
        this.pendingTimeout = undefined
        settled = true
        reject(error)
      }
    })

    // Auto-close server after callback or timeout (ticket requirement)
    const autoClose = (): Promise<void> => this.stop()
    promise.then(autoClose, autoClose)

    return promise
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)

    if (url.pathname !== this.callbackPath) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (error !== null) {
      res.writeHead(400, {'Content-Type': 'text/html'})
      res.end(`<html><body><h1>Authentication failed</h1><p>${escapeHtml(errorDescription ?? error)}</p></body></html>`)
      this.onError?.(new ProviderCallbackOAuthError(error, errorDescription ?? undefined))
      return
    }

    if (code === null || state === null) {
      res.writeHead(400, {'Content-Type': 'text/html'})
      res.end('<html><body><h1>Authentication failed</h1><p>Missing code or state parameter</p></body></html>')
      this.onError?.(new ProviderOAuthError('Missing code or state parameter'))
      return
    }

    res.writeHead(200, {'Content-Type': 'text/html'})
    res.end(SUCCESS_HTML)
    this.onCallback?.(code, state)
  }
}
