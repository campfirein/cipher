import {expect} from 'chai'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resolveVertexAiProject} from '../../../../src/server/infra/provider/vertex-ai-utils.js'

describe('resolveVertexAiProject', () => {
  let tempDir: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tempDir = join(tmpdir(), `brv-test-vertex-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, {recursive: true})
    savedEnv.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT
    savedEnv.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }

    try {
      rmSync(tempDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should prefer GOOGLE_CLOUD_PROJECT env var', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project'
    const credPath = join(tempDir, 'sa.json')
    // eslint-disable-next-line camelcase
    writeFileSync(credPath, JSON.stringify({project_id: 'file-project'}))

    const result = resolveVertexAiProject(credPath)

    expect(result).to.equal('env-project')
  })

  it('should extract project_id from credential file when env var is not set', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    const credPath = join(tempDir, 'sa.json')
    // eslint-disable-next-line camelcase
    writeFileSync(credPath, JSON.stringify({project_id: 'file-project', type: 'service_account'}))

    const result = resolveVertexAiProject(credPath)

    expect(result).to.equal('file-project')
  })

  it('should fall back to GOOGLE_APPLICATION_CREDENTIALS when no explicit path given', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    const credPath = join(tempDir, 'adc.json')
    // eslint-disable-next-line camelcase
    writeFileSync(credPath, JSON.stringify({project_id: 'adc-project'}))
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath

    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = resolveVertexAiProject(undefined)

    expect(result).to.equal('adc-project')
  })

  it('should return undefined when credential file has no project_id', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    const credPath = join(tempDir, 'sa.json')
    writeFileSync(credPath, JSON.stringify({type: 'service_account'}))

    const result = resolveVertexAiProject(credPath)

    expect(result).to.be.undefined
  })

  it('should return undefined when credential file does not exist', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS

    const result = resolveVertexAiProject('/nonexistent/path.json')

    expect(result).to.be.undefined
  })

  it('should return undefined when credential file contains invalid JSON', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    const credPath = join(tempDir, 'bad.json')
    writeFileSync(credPath, 'not-json')

    const result = resolveVertexAiProject(credPath)

    expect(result).to.be.undefined
  })

  it('should return undefined when no credential path and no env vars', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS

    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = resolveVertexAiProject(undefined)

    expect(result).to.be.undefined
  })
})
