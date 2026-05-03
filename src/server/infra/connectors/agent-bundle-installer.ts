import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {Agent} from '../../../shared/types/agent.js'

import {type ArtifactSpec, type ArtifactType, getAgentBundle} from './agent-bundle-config.js'
import {BRV_RULE_MARKERS} from './shared/constants.js'

export type InstalledStep = {
  artifact: ArtifactType
  path: string
}

export type SkipReason = 'already-exists' | 'completed-marker' | 'skipped-marker'

export type SkippedStep = {
  artifact: ArtifactType
  reason: SkipReason
}

export type AgentBundleResult = {
  agent: Agent
  installed: InstalledStep[]
  skipped: SkippedStep[]
}

const TEMPLATES_BASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates')
const TEMPLATES_AGENTS = join(TEMPLATES_BASE, 'agents')
const TEMPLATES_SHARED = join(TEMPLATES_BASE, 'shared')

const ONBOARDING_SKIPPED_MARKER = join('.brv', 'onboarding-skipped')
const ONBOARDING_COMPLETED_MARKER = join('.brv', 'onboarding-completed')

function evaluateOnboardingSkip(projectRoot: string, targetAbsolute: string): SkipReason | undefined {
  if (existsSync(join(projectRoot, ONBOARDING_SKIPPED_MARKER))) return 'skipped-marker'
  if (existsSync(join(projectRoot, ONBOARDING_COMPLETED_MARKER))) return 'completed-marker'
  if (existsSync(targetAbsolute)) return 'already-exists'
  return undefined
}

function buildMarkerBlock(content: string): string {
  return `${BRV_RULE_MARKERS.START}\n\n${content.trim()}\n\n${BRV_RULE_MARKERS.END}`
}

function applyMarkerBlock(existing: string, templateContent: string): string {
  const block = buildMarkerBlock(templateContent)
  const startIdx = existing.indexOf(BRV_RULE_MARKERS.START)
  const endIdx = existing.indexOf(BRV_RULE_MARKERS.END)

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx)
    const after = existing.slice(endIdx + BRV_RULE_MARKERS.END.length)
    return `${before}${block}${after}`
  }

  if (existing.length === 0) return `${block}\n`
  return `${block}\n\n${existing.startsWith('\n') ? existing.slice(1) : existing}`
}

async function loadTemplate(templateDir: string, templateFile: string): Promise<string> {
  const agentPath = join(TEMPLATES_AGENTS, templateDir, templateFile)
  if (existsSync(agentPath)) return readFile(agentPath, 'utf8')
  return readFile(join(TEMPLATES_SHARED, templateFile), 'utf8')
}

function substituteVars(content: string, vars: Record<string, string> | undefined): string {
  if (!vars) return content
  return content.replaceAll(/\{\{var:([^}]+)\}\}/g, (match, name: string) => vars[name.trim()] ?? match)
}

async function applyArtifact(
  templateDir: string,
  artifact: ArtifactSpec,
  projectRoot: string,
): Promise<{path: string; result: 'installed'} | {reason: SkipReason; result: 'skipped'}> {
  const target = join(projectRoot, artifact.targetPath)

  if (artifact.conditional === 'onboarding') {
    const skip = evaluateOnboardingSkip(projectRoot, target)
    if (skip) return {reason: skip, result: 'skipped'}
  }

  const rawTemplate = await loadTemplate(templateDir, artifact.templateFile)
  const templateContent = substituteVars(rawTemplate, artifact.templateVars)
  await mkdir(dirname(target), {recursive: true})

  if (artifact.mergeMode === 'marker-block') {
    const existing = existsSync(target) ? await readFile(target, 'utf8') : ''
    await writeFile(target, applyMarkerBlock(existing, templateContent), 'utf8')
  } else {
    await writeFile(target, templateContent, 'utf8')
  }

  return {path: target, result: 'installed'}
}

export async function installAgentBundle(agent: Agent, projectRoot: string): Promise<AgentBundleResult> {
  const bundle = getAgentBundle(agent)
  if (!bundle) {
    throw new Error(`No connect bundle defined for agent "${agent}".`)
  }

  const outcomes = await Promise.all(
    bundle.artifacts.map(async (artifact) => ({
      artifact,
      outcome: await applyArtifact(bundle.templateDir, artifact, projectRoot),
    })),
  )

  const installed: InstalledStep[] = []
  const skipped: SkippedStep[] = []
  for (const {artifact, outcome} of outcomes) {
    if (outcome.result === 'installed') {
      installed.push({artifact: artifact.type, path: outcome.path})
    } else {
      skipped.push({artifact: artifact.type, reason: outcome.reason})
    }
  }

  return {agent, installed, skipped}
}
