import type {SlashCommand} from '../../../types/commands.js'

import {worktreeAddSubCommand} from './worktree-add.js'
import {worktreeListSubCommand} from './worktree-list.js'
import {worktreeRemoveSubCommand} from './worktree-remove.js'

export const worktreeCommand: SlashCommand = {
  description: 'Manage worktree links for nested directories',
  name: 'worktree',
  subCommands: [worktreeAddSubCommand, worktreeRemoveSubCommand, worktreeListSubCommand],
}
