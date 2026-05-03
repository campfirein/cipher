import type {Agent} from '../../../shared/types/agent.js'

/**
 * Each artifact in an agent's bundle is one file written to a known path
 * inside the project root. The template lives at
 *   src/server/templates/agents/<templateDir>/<templateFile>
 * with fallback to
 *   src/server/templates/shared/<templateFile>
 *
 * `conditional: 'onboarding'` marks an artifact that should be skipped when
 * marker files indicate the user has dismissed or completed onboarding,
 * or when the target already exists (mid-flight).
 *
 * `templateVars` supplies values for `{{var:name}}` placeholders in the
 * template body — used when one shared template has agent-specific paths.
 */
export type ArtifactType = 'directive' | 'onboarding-skill' | 'recall-skill' | 'sub-agent'

export type MergeMode = 'marker-block' | 'overwrite'

export type ArtifactSpec = {
  conditional?: 'onboarding'
  mergeMode?: MergeMode
  targetPath: string
  templateFile: string
  templateVars?: Record<string, string>
  type: ArtifactType
}

export type AgentBundle = {
  agent: Agent
  artifacts: ArtifactSpec[]
  templateDir: string
}

/**
 * Per-agent paths used to compose a standard bundle. `skillDir` is the
 * project-scope skill directory (e.g. `.claude/skills`). `rulesFile` is
 * where the directive block goes; `rulesMergeMode` is `marker-block` for
 * shared instruction files (CLAUDE.md, AGENTS.md) or `overwrite` for
 * dedicated byterover rule files (`.cursor/rules/byterover.mdc`, etc).
 */
type AgentPaths = {
  /** Extra agent-specific artifacts beyond the standard skill+directive pair */
  extras?: ArtifactSpec[]
  rulesFile?: string
  rulesMergeMode?: MergeMode
  skillDir?: string
}

function recallSkillArtifact(skillDir: string): ArtifactSpec {
  return {
    targetPath: `${skillDir}/byterover/SKILL.md`,
    templateFile: 'recall-skill.md',
    type: 'recall-skill',
  }
}

function onboardingSkillArtifact(skillDir: string): ArtifactSpec {
  const onboardingDir = `${skillDir}/byterover-onboarding/`
  return {
    conditional: 'onboarding',
    targetPath: `${onboardingDir}SKILL.md`,
    templateFile: 'onboarding-skill.md',
    templateVars: {skillDir: onboardingDir},
    type: 'onboarding-skill',
  }
}

function directiveArtifact(rulesFile: string, mergeMode: MergeMode): ArtifactSpec {
  return {
    mergeMode,
    targetPath: rulesFile,
    templateFile: 'directive.md',
    type: 'directive',
  }
}

function buildBundle(agent: Agent, templateDir: string, paths: AgentPaths): AgentBundle {
  const artifacts: ArtifactSpec[] = []

  if (paths.skillDir) {
    artifacts.push(recallSkillArtifact(paths.skillDir), onboardingSkillArtifact(paths.skillDir))
  }

  if (paths.rulesFile) {
    artifacts.push(directiveArtifact(paths.rulesFile, paths.rulesMergeMode ?? 'marker-block'))
  }

  if (paths.extras) {
    artifacts.push(...paths.extras)
  }

  return {agent, artifacts, templateDir}
}

const BUNDLES: Partial<Record<Agent, AgentBundle>> = {
  Amp: buildBundle('Amp', 'amp', {
    rulesFile: 'AGENTS.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.agents/skills',
  }),
  Antigravity: buildBundle('Antigravity', 'antigravity', {
    rulesFile: '.agent/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.agent/skills',
  }),
  'Auggie CLI': buildBundle('Auggie CLI', 'auggie-cli', {
    rulesFile: '.augment/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.augment/skills',
  }),
  'Claude Code': buildBundle('Claude Code', 'claude-code', {
    extras: [
      {
        targetPath: '.claude/agents/byterover.md',
        templateFile: 'sub-agent.md',
        type: 'sub-agent',
      },
    ],
    rulesFile: 'CLAUDE.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.claude/skills',
  }),
  Codex: buildBundle('Codex', 'codex', {
    rulesFile: 'AGENTS.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.agents/skills',
  }),
  Cursor: buildBundle('Cursor', 'cursor', {
    rulesFile: '.cursor/rules/byterover.mdc',
    rulesMergeMode: 'overwrite',
    skillDir: '.cursor/skills',
  }),
  'Gemini CLI': buildBundle('Gemini CLI', 'gemini-cli', {
    rulesFile: 'GEMINI.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.gemini/skills',
  }),
  'Github Copilot': buildBundle('Github Copilot', 'github-copilot', {
    rulesFile: '.github/copilot-instructions.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.github/skills',
  }),
  Junie: buildBundle('Junie', 'junie', {
    rulesFile: '.junie/guidelines.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.junie/skills',
  }),
  'Kilo Code': buildBundle('Kilo Code', 'kilo-code', {
    rulesFile: '.kilocode/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.kilocode/skills',
  }),
  Kiro: buildBundle('Kiro', 'kiro', {
    rulesFile: '.kiro/steering/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.kiro/skills',
  }),
  OpenClaude: buildBundle('OpenClaude', 'openclaude', {
    rulesFile: 'CLAUDE.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.claude/skills',
  }),
  OpenCode: buildBundle('OpenCode', 'opencode', {
    rulesFile: 'AGENTS.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.opencode/skills',
  }),
  Qoder: buildBundle('Qoder', 'qoder', {
    rulesFile: '.qoder/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.qoder/skills',
  }),
  'Roo Code': buildBundle('Roo Code', 'roo-code', {
    rulesFile: '.roo/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.roo/skills',
  }),
  'Trae.ai': buildBundle('Trae.ai', 'trae-ai', {
    rulesFile: 'project_rules.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.trae/skills',
  }),
  Warp: buildBundle('Warp', 'warp', {
    rulesFile: 'WARP.md',
    rulesMergeMode: 'marker-block',
    skillDir: '.warp/skills',
  }),
  Windsurf: buildBundle('Windsurf', 'windsurf', {
    rulesFile: '.windsurf/rules/byterover.md',
    rulesMergeMode: 'overwrite',
    skillDir: '.windsurf/skills',
  }),
}

export function getAgentBundle(agent: Agent): AgentBundle | undefined {
  return BUNDLES[agent]
}

export function isBundleSupported(agent: Agent): boolean {
  return agent in BUNDLES
}

export function listSupportedBundleAgents(): Agent[] {
  return Object.keys(BUNDLES) as Agent[]
}
