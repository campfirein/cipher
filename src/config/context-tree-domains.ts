/**
 * Domain configurations for the context tree structure.
 * Each domain represents a specific area of knowledge in the project.
 */
export interface DomainConfig {
  description: string
  name: string
}

/**
 * Predefined domains that will be scaffolded during project initialization.
 */
export const CONTEXT_TREE_DOMAINS: DomainConfig[] = [
  {
    description: 'Ensure all code follows style guidelines and quality standards',
    name: 'code_style',
  },
  {
    description: 'UI libraries, themes, and design guidelines',
    name: 'design',
  },
  {
    description: 'Project structure, components, and related context',
    name: 'structure',
  },
  {
    description: 'Security and compliance information',
    name: 'compliance',
  },
  {
    description: 'Testing implementation context',
    name: 'testing',
  },
  {
    description: 'Bug fixing logic and procedures',
    name: 'bug_fixes',
  },
]
