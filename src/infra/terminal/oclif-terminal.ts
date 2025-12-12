import {confirm, input, search, select} from '@inquirer/prompts'
import {Command, ux} from '@oclif/core'
import {fileSelector, ItemType} from 'inquirer-file-selector'

import type {
  ConfirmOptions,
  FileSelectorItem,
  FileSelectorOptions,
  InputOptions,
  ITerminal,
  SearchOptions,
  SelectOptions,
} from '../../core/interfaces/i-terminal.js'

/**
 * Terminal implementation that wraps oclif Command methods and @inquirer/prompts.
 */
export class OclifTerminal implements ITerminal {
  constructor(private readonly command: Command) {}

  actionStart(message: string): void {
    ux.action.start(message)
  }

  actionStop(message?: string): void {
    ux.action.stop(message)
  }

  confirm({default: defaultValue = true, message}: ConfirmOptions): Promise<boolean> {
    return confirm({default: defaultValue, message})
  }

  error(message: string): void {
    this.command.error(message)
  }

  async fileSelector(options: FileSelectorOptions): Promise<FileSelectorItem | null> {
    const baseConfig = {
      basePath: options.basePath,
      filter: options.filter,
      message: options.message,
      pageSize: options.pageSize,
      theme: options.theme,
      type: options.type === 'directory' ? ItemType.Directory : ItemType.File,
    }

    // Use separate calls to help TypeScript infer the correct overload
    const result = options.allowCancel
      ? await fileSelector({...baseConfig, allowCancel: true})
      : await fileSelector({...baseConfig, allowCancel: false})

    if (!result) return null

    return {
      isDirectory: result.isDirectory,
      name: result.name,
      path: result.path,
    }
  }

  input({message, validate}: InputOptions): Promise<string> {
    return input({message, validate})
  }

  log(message?: string): void {
    this.command.log(message)
  }

  search<T>({message, source}: SearchOptions<T>): Promise<T> {
    return search({message, source})
  }

  select<T>({choices, message}: SelectOptions<T>): Promise<T> {
    return select({choices, message})
  }

  warn(message: string): void {
    this.command.warn(message)
  }
}
