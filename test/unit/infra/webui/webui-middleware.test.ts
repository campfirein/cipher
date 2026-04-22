import type {AddressInfo} from 'node:net'

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, get as httpGet, type Server as HttpServer, type IncomingMessage} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createWebUiMiddleware} from '../../../../src/server/infra/webui/webui-middleware.js'

interface HttpResult {
  body: string
  status: number
}

async function httpRequest(url: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res: IncomingMessage) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({body: Buffer.concat(chunks).toString('utf8'), status: res.statusCode ?? 0})
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

describe('createWebUiMiddleware', () => {
  let testDir: string
  let httpServer: HttpServer | undefined

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-webui-mw-test-')))
  })

  afterEach(async () => {
    if (httpServer) {
      const server = httpServer
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      httpServer = undefined
    }

    try {
      rmSync(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  async function startServer(webuiDistDir: string): Promise<number> {
    const app = createWebUiMiddleware({
      getConfig: () => ({daemonPort: 1, port: 2, projectCwd: '/', version: '0'}),
      webuiDistDir,
    })

    const server = createServer(app)
    httpServer = server
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    const addr = server.address() as AddressInfo
    return addr.port
  }

  it('should serve index.html for SPA routes when install path contains a dotfile component', async () => {
    // Simulate global nvm install where path contains ".nvm"
    const nestedRoot = join(testDir, '.nvm', 'dist', 'webui')
    mkdirSync(nestedRoot, {recursive: true})
    const indexHtml = '<!doctype html><html><body>brv</body></html>'
    writeFileSync(join(nestedRoot, 'index.html'), indexHtml, 'utf8')

    const port = await startServer(nestedRoot)
    const response = await httpRequest(`http://127.0.0.1:${port}/contexts?branch=main`)

    expect(response.status).to.equal(200)
    expect(response.body).to.equal(indexHtml)
  })

  it('should serve static assets when install path contains a dotfile component', async () => {
    const nestedRoot = join(testDir, '.nvm', 'dist', 'webui')
    mkdirSync(join(nestedRoot, 'assets'), {recursive: true})
    writeFileSync(join(nestedRoot, 'index.html'), 'index', 'utf8')
    writeFileSync(join(nestedRoot, 'assets', 'main.js'), 'console.log(1)', 'utf8')

    const port = await startServer(nestedRoot)
    const response = await httpRequest(`http://127.0.0.1:${port}/assets/main.js`)

    expect(response.status).to.equal(200)
    expect(response.body).to.equal('console.log(1)')
  })
})
