import type {Stats} from 'node:fs'

import {statSync} from 'node:fs'
import {join} from 'node:path'

import type {Agent} from '../../../shared/types/agent.js'

function safeStat(fullPath: string): Stats | undefined {
  try {
    return statSync(fullPath)
  } catch {
    return undefined
  }
}

export type DetectedAgent = {
  agent: Agent
  evidence: string
}

type DetectionRule = {
  agent: Agent
  check: (projectRoot: string) => string | undefined
}

const DETECTION_RULES: DetectionRule[] = [
  {
    agent: 'Claude Code',
    check: (root) => directoryEvidence(root, '.claude'),
  },
  {
    agent: 'Cursor',
    check: (root) => directoryEvidence(root, '.cursor'),
  },
  {
    agent: 'Windsurf',
    check: (root) => directoryEvidence(root, '.windsurf'),
  },
  {
    agent: 'Github Copilot',
    check: (root) => fileEvidence(root, '.github/copilot-instructions.md'),
  },
  {
    agent: 'Codex',
    check: (root) => directoryEvidence(root, '.agents'),
  },
  {
    agent: 'Gemini CLI',
    check: (root) => directoryEvidence(root, '.gemini'),
  },
  {
    agent: 'Kiro',
    check: (root) => directoryEvidence(root, '.kiro'),
  },
  {
    agent: 'Roo Code',
    check: (root) => directoryEvidence(root, '.roo'),
  },
  {
    agent: 'Junie',
    check: (root) => directoryEvidence(root, '.junie'),
  },
  {
    agent: 'Qoder',
    check: (root) => directoryEvidence(root, '.qoder'),
  },
  {
    agent: 'Trae.ai',
    check: (root) => directoryEvidence(root, '.trae'),
  },
  {
    agent: 'Warp',
    check: (root) => directoryEvidence(root, '.warp'),
  },
  {
    agent: 'Kilo Code',
    check: (root) => directoryEvidence(root, '.kilocode'),
  },
]

function directoryEvidence(projectRoot: string, relativePath: string): string | undefined {
  const stats = safeStat(join(projectRoot, relativePath))
  return stats?.isDirectory() ? `${relativePath}/ directory` : undefined
}

function fileEvidence(projectRoot: string, relativePath: string): string | undefined {
  const stats = safeStat(join(projectRoot, relativePath))
  return stats?.isFile() ? `${relativePath} file` : undefined
}

export function detectAgents(projectRoot: string): DetectedAgent[] {
  const detected: DetectedAgent[] = []

  for (const rule of DETECTION_RULES) {
    const evidence = rule.check(projectRoot)
    if (evidence) {
      detected.push({agent: rule.agent, evidence})
    }
  }

  return detected
}
