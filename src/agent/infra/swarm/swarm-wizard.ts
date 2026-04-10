import type {ScaffoldInput} from './swarm-scaffolder.js'
import type {AdapterType} from './types.js'

import {KNOWN_ADAPTER_TYPES} from './types.js'

// ─── Injectable Prompt Interface ───

export type WizardPrompts = {
  checkbox(message: string, choices: Array<{name: string; value: string}>): Promise<string[]>
  confirm(message: string): Promise<boolean>
  input(message: string, opts?: {default?: string; validate?: (v: string) => boolean | string}): Promise<string>
  select(message: string, choices: Array<{name: string; value: string}>): Promise<string>
}

// ─── Wizard State ───

type WizardState = {
  agents: Array<{adapterType: AdapterType; description: string; name: string; slug: string}>
  description: string
  edges: Array<{from: string; to: string}>
  goals: string[]
  name: string
  outputNodeSlug: string
  slug: string
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

// ─── Step Implementations ───
// Steps are inherently sequential interactive prompts — each depends on the previous answer.
/* eslint-disable no-await-in-loop */

async function stepIdentity(prompts: WizardPrompts, state: WizardState): Promise<void> {
  state.name = await prompts.input('Swarm name', {
    default: state.name || undefined,
    validate: (v) => v.trim().length > 0 || 'Name is required',
  })
  state.slug = await prompts.input('Slug', {
    default: toSlug(state.name),
    validate: (v) => /^[a-z0-9-]+$/.test(v) || 'Slug must be lowercase letters, numbers, and hyphens',
  })
  state.description = await prompts.input('Description', {
    default: state.description || undefined,
    validate: (v) => v.trim().length > 0 || 'Description is required',
  })
  const goalsRaw = await prompts.input('Goals (comma-separated)', {
    default: state.goals.length > 0 ? state.goals.join(', ') : undefined,
    validate: (v) => v.trim().length > 0 || 'At least one goal is required',
  })
  state.goals = goalsRaw.split(',').map((g) => g.trim()).filter(Boolean)
}

async function stepAgents(prompts: WizardPrompts, state: WizardState): Promise<void> {
  const agents: typeof state.agents = []
  let addMore = true

  while (addMore) {
    const name = await prompts.input(`Agent ${agents.length + 1} name`, {
      validate(v) { return v.trim().length > 0 || 'Name is required' },
    })
    const slug = await prompts.input('Slug', {
      default: toSlug(name),
      validate(v) {
        if (!/^[a-z0-9-]+$/.test(v)) return 'Slug must be lowercase letters, numbers, and hyphens'
        if (agents.some((a) => a.slug === v)) return `Slug "${v}" already used`

        return true
      },
    })
    const description = await prompts.input('Description', {
      validate(v) { return v.trim().length > 0 || 'Description is required' },
    })
    const adapterType = await prompts.select(
      'Adapter type',
      KNOWN_ADAPTER_TYPES.map((t) => ({name: t, value: t})),
    ) as AdapterType

    agents.push({adapterType, description, name, slug})

    addMore = await prompts.confirm('Add another agent?')
  }

  state.agents = agents
}

async function stepEdges(prompts: WizardPrompts, state: WizardState): Promise<void> {
  const edges: Array<{from: string; to: string}> = []

  for (const agent of state.agents) {
    const targets = state.agents.filter((a) => a.slug !== agent.slug)
    if (targets.length === 0) continue

    const selected = await prompts.checkbox(
      `Which agents should receive output from "${agent.name}"?`,
      targets.map((t) => ({name: t.name, value: t.slug})),
    )

    for (const target of selected) {
      edges.push({from: agent.slug, to: target})
    }
  }

  state.edges = edges
}

async function stepOutput(prompts: WizardPrompts, state: WizardState): Promise<void> {
  state.outputNodeSlug = await prompts.select(
    'Which agent produces the final output?',
    state.agents.map((a) => ({name: a.name, value: a.slug})),
  )
}

/* eslint-enable no-await-in-loop */

// ─── Main Wizard ───

const STEPS = [stepIdentity, stepAgents, stepEdges, stepOutput] as const

/**
 * Runs the interactive swarm scaffolding wizard.
 * Returns ScaffoldInput on success, null if user cancels.
 *
 * Errors with name 'AbortPromptError' trigger back-navigation.
 * Errors with name 'ExitPromptError' or 'CancelPromptError' cancel the wizard.
 */
export async function runWizard(prompts: WizardPrompts): Promise<null | ScaffoldInput> {
  const state: WizardState = {
    agents: [],
    description: '',
    edges: [],
    goals: [],
    name: '',
    outputNodeSlug: '',
    slug: '',
  }

  let stepIndex = 0
  while (stepIndex < STEPS.length) {
    try {
      await STEPS[stepIndex](prompts, state) // eslint-disable-line no-await-in-loop
      stepIndex++
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortPromptError') {
        if (stepIndex === 0) return null
        stepIndex--
      } else if (
        error instanceof Error &&
        (error.name === 'ExitPromptError' || error.name === 'CancelPromptError')
      ) {
        return null
      } else {
        throw error
      }
    }
  }

  return {
    agents: state.agents,
    description: state.description,
    edges: state.edges,
    goals: state.goals,
    name: state.name,
    outputNodeSlug: state.outputNodeSlug,
    slug: state.slug,
  }
}
