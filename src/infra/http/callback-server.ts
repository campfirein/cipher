/* eslint-disable camelcase */
import type {Server} from 'node:http'

import express from 'express'

import {AuthenticationError} from '../../core/domain/errors/auth-error.js'

type CallbackResult = {
  code: string
  state: string
}

export class CallbackServer {
  private app = express()
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
    })
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server === undefined) {
        resolve()
      } else {
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

  private getErrorPage(error: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Authentication Failed</h1>
            <p>${error}</p>
            <p>Please try again or contact support.</p>
          </div>
        </body>
      </html>
    `
  }

  private getSuccessPage(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #22c55e; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Authentication Successful</h1>
            <p>You can close this window and return to the CLI.</p>
          </div>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body>
      </html>
    `
  }

  private setupRoutes(): void {
    this.app.get('/callback', (req, res) => {
      const {code, error, error_description, state} = req.query
      if (error !== undefined) {
        const errorMessage = error_description ?? error
        this.app.locals.onError?.(String(errorMessage))
        res.send(this.getErrorPage(String(errorMessage)))
        return
      }

      if (code === undefined || state === undefined) {
        this.app.locals.onError?.('Missing code or state parameter')
        res.send(this.getErrorPage('Missing required parameters'))
        return
      }

      this.app.locals.onCallback?.(String(code), String(state))
      res.send(this.getSuccessPage())
    })
  }
}
