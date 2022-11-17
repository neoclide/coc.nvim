'use strict'
import { path } from '../util/node'
import { isFalsyOrEmpty, toArray } from './array'
import { isParentFolder, sameFile } from './fs'
import { Registry } from './registry'
import { toText } from './string'

const PLUGIN_ROOT = global.__TEST__ ? path.resolve(__dirname, '../..') : path.dirname(__dirname)

/**
 * Contains static extension infos
 */
export const Extensions = {
  ExtensionContribution: 'base.contributions.extensions'
}

export interface CommandContribution {
  readonly title: string
  readonly command: string
}

export interface RootPatternContrib {
  readonly filetype: string
  readonly patterns?: string[]
}

export interface IExtensionInfo {
  readonly name: string,
  readonly directory: string,
  readonly filepath?: string
  readonly onCommands?: string[]
  readonly commands?: CommandContribution[]
  readonly rootPatterns?: RootPatternContrib[]
}

export interface IExtensionContributions {
  extensions: Iterable<IExtensionInfo>
}

export interface IExtensionRegistry {

  /**
   * Commands for activate extensions.
   */
  readonly onCommands: string[]

  /**
   * Commands contributed from extensions.
   */
  readonly commands: CommandContribution[]

  getCommandTitle(id: string): string | undefined
  /**
   * Root patterns by filetype.
   */
  getRootPatternsByFiletype(filetype: string): string[]

  /**
   * Register a extension to the registry.
   */
  registerExtension(id: string, info: IExtensionInfo): void

  /**
   * Remove a extension from registry
   */
  unregistExtension(id: string): void

  /**
   * Get all extensions
   */
  getExtensions(): IExtensionContributions
}

/**
 * Registry for loaded extensions.
 */
class ExtensionRegistry implements IExtensionRegistry {
  private extensionsById: Map<string, IExtensionInfo>

  constructor() {
    this.extensionsById = new Map()
  }

  public get onCommands(): string[] {
    let res: string[] = []
    for (let item of this.extensionsById.values()) {
      res.push(...(toArray(item.onCommands).filter(s => typeof s === 'string')))
    }
    return res
  }

  public getCommandTitle(id: string): string | undefined {
    for (let item of this.extensionsById.values()) {
      for (let cmd of toArray(item.commands)) {
        if (cmd.command === id) return cmd.title
      }
    }
    return undefined
  }

  public get commands(): CommandContribution[] {
    let res: CommandContribution[] = []
    for (let item of this.extensionsById.values()) {
      res.push(...(toArray(item.commands).filter(validCommandContribution)))
    }
    return res
  }

  public getRootPatternsByFiletype(filetype: string): string[] {
    let res: string[] = []
    for (let item of this.extensionsById.values()) {
      for (let p of toArray(item.rootPatterns).filter(validRootPattern)) {
        if (p.filetype === filetype) res.push(...p.patterns.filter(s => typeof s === 'string'))
      }
    }
    return res
  }

  public unregistExtension(id: string): void {
    this.extensionsById.delete(id)
  }

  public registerExtension(id: string, info: IExtensionInfo): void {
    this.extensionsById.set(id, info)
  }

  public getExtensions(): IExtensionContributions {
    return { extensions: this.extensionsById.values() }
  }
}

let extensionRegistry = new ExtensionRegistry()
Registry.add(Extensions.ExtensionContribution, extensionRegistry)

export function validRootPattern(rootPattern: RootPatternContrib | undefined): boolean {
  return rootPattern && typeof rootPattern.filetype === 'string' && !isFalsyOrEmpty(rootPattern.patterns)
}

export function validCommandContribution(cmd: CommandContribution | undefined): boolean {
  return cmd && typeof cmd.command === 'string' && typeof cmd.title === 'string'
}

/**
 * Get extension name from error stack
 */
export function parseExtensionName(stack: string, level = 2): string | undefined {
  let line = stack.split(/\r?\n/).slice(level)[0]
  if (!line) return undefined
  line = line.replace(/^\s*at\s*/, '')
  let filepath: string
  if (line.endsWith(')')) {
    let ms = line.match(/(\((.*?):\d+:\d+\))$/)
    if (ms) filepath = ms[2]
  } else {
    let ms = line.match(/(.*?):\d+:\d+$/)
    if (ms) filepath = ms[1]
  }
  if (!filepath) return undefined
  let arr = Array.from(extensionRegistry.getExtensions().extensions)
  let find = arr.find(o => sameFile(toText(o.filepath), filepath))
  if (find) return find.name
  find = arr.find(o => isParentFolder(o.directory, filepath))
  if (find) return find.name
  if (isParentFolder(PLUGIN_ROOT, filepath)) return 'coc.nvim'
}
