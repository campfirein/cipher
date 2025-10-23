/* eslint-disable camelcase */
import type {Server} from 'node:http'
import type {Socket} from 'node:net'

import express from 'express'

import {AuthenticationError} from '../../core/domain/errors/auth-error.js'

type CallbackResult = {
  code: string
  state: string
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
      const {code, error, error_description, state} = req.query
      if (error !== undefined) {
        const errorMessage = error_description ?? error
        this.app.locals.onError?.(String(errorMessage))
        res.status(400).send(`Authentication failed: ${String(errorMessage)}`)
        return
      }

      if (code === undefined || state === undefined) {
        this.app.locals.onError?.('Missing code or state parameter')
        res.status(400).send('Authentication failed: Missing required parameters')
        return
      }

      this.app.locals.onCallback?.(String(code), String(state))
      res.status(200).send('Authentication successful. You can close this window.')
    })
  }
}
