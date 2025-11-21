/**
 * Unit tests for ClaudeCleanService
 * Tests transformation of Claude raw sessions to clean format
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from 'chai'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sinon from 'sinon'

import { Agent } from '../../../../../src/core/domain/entities/agent.js'
import { ClaudeCleanService } from '../../../../../src/infra/parsers/clean/clean-claude-service.js'

describe('ClaudeCleanService', () => {
  let service: ClaudeCleanService
  let tempDir: string

  beforeEach(() => {
    service = new ClaudeCleanService('Claude Code' as Agent)
    tempDir = join(tmpdir(), `test-claude-clean-${Date.now()}`)
  })

  afterEach(() => {
    sinon.restore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  describe('parse', () => {
    it('should return array of CleanSession for valid sessions', async () => {
      const inputDir = join(tempDir, 'raw')
      const workspaceDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(workspaceDir, { recursive: true })

      // Create a sample session file
      const sessionData = {
        id: 'session-1',
        messages: [
          {
            content: 'Hello',
            timestamp: new Date().toISOString(),
            type: 'user'
          },
          {
            content: 'Hi there!',
            timestamp: new Date().toISOString(),
            type: 'assistant'
          }
        ],
        timestamp: Date.now(),
        title: 'Test Session'
      }

      fs.writeFileSync(
        join(workspaceDir, 'session-1.json'),
        JSON.stringify(sessionData)
      )

      const result = await service.parse(inputDir)

      // Should return array instead of boolean
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.be.greaterThan(0)

      // Verify CleanSession structure
      const session = result[0]
      expect(session).to.have.property('id')
      expect(session).to.have.property('messages')
      expect(session).to.have.property('timestamp')
      expect(session).to.have.property('title')
      expect(session).to.have.property('type')
      expect(session.type).to.equal('Claude')
    })

    it('should return empty array for directory with no sessions', async () => {
      const inputDir = join(tempDir, 'raw')
      fs.mkdirSync(inputDir, { recursive: true })

      const result = await service.parse(inputDir)

      expect(Array.isArray(result)).to.be.true
      expect(result).to.have.length(0)
    })

    it('should skip invalid JSON files and continue parsing', async () => {
      const inputDir = join(tempDir, 'raw')
      const workspaceDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(workspaceDir, { recursive: true })

      // Create invalid JSON file
      fs.writeFileSync(
        join(workspaceDir, 'invalid.json'),
        'invalid json'
      )

      // Create valid session file
      const validSessionData = {
        id: 'session-2',
        messages: [{content: 'Test', timestamp: new Date().toISOString(), type: 'user'}],
        timestamp: Date.now(),
        title: 'Valid Session'
      }
      fs.writeFileSync(
        join(workspaceDir, 'session-2.json'),
        JSON.stringify(validSessionData)
      )

      // Parse should skip invalid and return valid sessions
      const result = await service.parse(inputDir)
      expect(Array.isArray(result)).to.be.true
      expect(result.length).to.be.greaterThan(0)
    })

    it('should not write files to disk', async () => {
      const inputDir = join(tempDir, 'raw')
      const workspaceDir = join(inputDir, 'workspace-hash')
      fs.mkdirSync(workspaceDir, { recursive: true })

      // Create a sample session file
      const sessionData = {
        id: 'session-3',
        messages: [{content: 'Test', timestamp: new Date().toISOString(), type: 'user'}],
        timestamp: Date.now(),
        title: 'Test Session'
      }
      fs.writeFileSync(
        join(workspaceDir, 'session-3.json'),
        JSON.stringify(sessionData)
      )

      // Spy on writeFile to ensure it's NOT called
      const writeFileSpy = sinon.spy(fs.promises, 'writeFile')

      await service.parse(inputDir)

      expect(writeFileSpy).to.not.have.been.called
      writeFileSpy.restore()
    })
  })

  describe('calculateSimilarity', () => {
    it('should calculate string similarity score', () => {
      const result = (service as any).calculateSimilarity(
        'Hello world test',
        'Hello world'
      )
      expect(result).to.be.greaterThan(0)
    })

    it('should return 0 for very different strings', () => {
      const result = (service as any).calculateSimilarity(
        'Hello world',
        'xyz abc'
      )
      expect(result).to.equal(0)
    })

    it('should handle empty strings', () => {
      const result = (service as any).calculateSimilarity('', '')
      expect(result).to.equal(0)
    })
  })

  describe('identifyTaskToolIds', () => {
    it('should identify Task tool IDs from messages', () => {
      const messages = [
        {
          content: [
            {
              id: 'tool-1',
              input: { description: 'Test task' },
              name: 'Task',
              type: 'tool_use'
            }
          ],
          type: 'assistant'
        }
      ]

      const agentSessions = new Map([
        ['agent-1', {
          id: 'agent-1',
          messages: [],
          timestamp: Date.now(),
          title: 'Test task'
        }]
      ])

      const result = (service as any).identifyTaskToolIds(messages, agentSessions)
      expect(result).to.be.instanceOf(Set)
    })

    it('should skip non-Task tool types', () => {
      const messages = [
        {
          content: [
            {
              id: 'tool-1',
              input: {},
              name: 'SomethingElse',
              type: 'tool_use'
            }
          ],
          type: 'assistant'
        }
      ]

      const agentSessions = new Map()
      const result = (service as any).identifyTaskToolIds(messages, agentSessions)
      expect(result.size).to.equal(0)
    })
  })

  describe('findMatchingAgentSession', () => {
    it('should find matching agent session by similarity', () => {
      const agentSessions = new Map([
        ['agent-1', {
          id: 'agent-1',
          messages: [],
          timestamp: new Date().toISOString(),
          title: 'Test description here'
        }]
      ])

      const result = (service as any).findMatchingAgentSession(
        'Test description here',
        Date.now(),
        agentSessions
      )

      expect(result).to.not.be.null
    })

    it('should return null for no matching sessions', () => {
      const agentSessions = new Map()
      const result = (service as any).findMatchingAgentSession(
        'Some description',
        Date.now(),
        agentSessions
      )

      expect(result).to.be.null
    })
  })

  describe('consolidateAgentSessions', () => {
    it('should consolidate agent sessions into main session', async () => {
      const mainSession = {
        id: 'main',
        messages: [
          {
            content: [
              {
                id: 'tool-1',
                input: { description: 'Run agent' },
                name: 'Task',
                type: 'tool_use'
              }
            ],
            type: 'assistant'
          }
        ],
        title: 'Main'
      }

      const agentSessions = new Map([
        ['agent-1', {
          id: 'agent-1',
          messages: [
            {
              content: 'Do something',
              type: 'user'
            }
          ],
          title: 'Run agent'
        }]
      ])

      const result = await (service as any).consolidateAgentSessions(mainSession, agentSessions)
      expect(result).to.have.property('messages')
    })

    it('should return unchanged session if no agent sessions', async () => {
      const mainSession = {
        id: 'main',
        messages: [],
        title: 'Main'
      }

      const agentSessions = new Map()
      const result = await (service as any).consolidateAgentSessions(mainSession, agentSessions)
      expect(result).to.deep.equal(mainSession)
    })
  })

  describe('loadSessions', () => {
    it('should load and organize session files', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      fs.mkdirSync(workspaceDir, { recursive: true })

      const sessionData = { id: 'main-1', messages: [] }
      const agentData = { id: 'agent-1', messages: [] }

      fs.writeFileSync(
        join(workspaceDir, 'main-session.json'),
        JSON.stringify(sessionData)
      )
      fs.writeFileSync(
        join(workspaceDir, 'agent-session.json'),
        JSON.stringify(agentData)
      )

      const result = await (service as any).loadSessions(workspaceDir, ['main-session.json', 'agent-session.json'])

      expect(result.allSessions).to.be.instanceOf(Map)
      expect(result.agentSessions).to.be.instanceOf(Map)
    })

    it('should skip invalid JSON files', async () => {
      const workspaceDir = join(tempDir, 'workspace')
      fs.mkdirSync(workspaceDir, { recursive: true })

      fs.writeFileSync(
        join(workspaceDir, 'invalid.json'),
        'invalid json'
      )

      const result = await (service as any).loadSessions(workspaceDir, ['invalid.json'])

      expect(result.allSessions.size).to.equal(0)
      expect(result.agentSessions.size).to.equal(0)
    })
  })

  describe('processMainSessions', () => {
    it('should process and write main sessions', async () => {
      const outputDir = join(tempDir, 'output')
      fs.mkdirSync(outputDir, { recursive: true })

      const allSessions = new Map([
        ['session-1', {
          id: 'session-1',
          messages: [],
          timestamp: Date.now(),
          title: 'Test Session'
        }]
      ])

      const agentSessions = new Map()

      const result = await (service as any).processMainSessions(allSessions, agentSessions, outputDir)
      expect(result).to.equal(1)
    })
  })

  describe('flattenMessagesWithAgentSessions', () => {
    it('should flatten messages with agent sessions', () => {
      const messages = [
        {
          content: [
            {
              id: 'tool-1',
              name: 'Task',
              type: 'tool_use'
            }
          ],
          type: 'assistant'
        }
      ]

      const taskToolUseIds = new Set(['tool-1'])
      const agentSessions = new Map([
        ['agent-1', {
          messages: [
            { content: 'Task message', type: 'user' }
          ]
        }]
      ])

      const result = (service as any).flattenMessagesWithAgentSessions(
        messages,
        taskToolUseIds,
        agentSessions
      )

      expect(result).to.be.an('array')
    })
  })
})
