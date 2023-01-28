'use strict'
import { isFalsyOrEmpty, toArray } from './array'
import { pluginRoot } from './constants'
import { isParentFolder, sameFile } from './fs'
import { fs } from './node'
import * as Is from './is'
import type { IJSONSchema } from './jsonSchema'
import { toObject } from './object'
import { Registry } from './registry'

export type IStringDictionary<V> = Record<string, V>

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
  readonly definitions?: IStringDictionary<IJSONSchema>
}

export interface IExtensionContributions {
  extensions: Iterable<IExtensionInfo>
}

export interface IExtensionRegistry {

  /**
   * Commands for activate extensions.
   */
  readonly onCommands: ({ id: string, title: string })[]

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
   * Get extension info.
   */
  getExtension(id: string): IExtensionInfo
  /**
   * Get all extensions
   */
  getExtensions(): IExtensionContributions

  resolveExtension(filepath: string): IExtensionInfo | undefined
}

/**
 * Registry for loaded extensions.
 */
class ExtensionRegistry implements IExtensionRegistry {
  private extensionsById: Map<string, IExtensionInfo>

  constructor() {
    this.extensionsById = new Map()
  }
  public resolveExtension(filepath: string): IExtensionInfo {
    for (let item of this.extensionsById.values()) {
      if (item.filepath && sameFile(item.filepath, filepath)) {
        return item
      }
      if (!item.name.startsWith('single-')
        && fs.existsSync(item.directory)
        && isParentFolder(fs.realpathSync(item.directory), filepath, false)) {
        return item
      }
    }
    return undefined
  }

  public get onCommands(): ({ id: string, title: string })[] {
    let res: ({ id: string, title: string })[] = []
    for (let item of this.extensionsById.values()) {
      let { commands, onCommands } = item
      for (let cmd of onCommands) {
        if (typeof cmd === 'string') {
          let find = commands.find(o => o.command === cmd)
          let title = find == null ? '' : find.title
          res.push({ id: cmd, title })
        }
      }
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

  public getExtension(id: string): IExtensionInfo {
    return this.extensionsById.get(id)
  }

  public getExtensions(): IExtensionContributions {
    return { extensions: this.extensionsById.values() }
  }
}

let extensionRegistry = new ExtensionRegistry()
Registry.add(Extensions.ExtensionContribution, extensionRegistry)

export function getExtensionDefinitions(): IStringDictionary<IJSONSchema> {
  let obj = {}
  for (let extensionInfo of extensionRegistry.getExtensions().extensions) {
    let definitions = extensionInfo.definitions
    Object.entries(toObject(definitions)).forEach(([key, val]) => {
      obj[key] = val
    })
  }
  return obj
}

export function validRootPattern(rootPattern: RootPatternContrib | undefined): boolean {
  return rootPattern && typeof rootPattern.filetype === 'string' && !isFalsyOrEmpty(rootPattern.patterns)
}

export function validCommandContribution(cmd: CommandContribution | undefined): boolean {
  return cmd && typeof cmd.command === 'string' && typeof cmd.title === 'string'
}

export function getProperties(configuration: object): IStringDictionary<IJSONSchema> {
  let obj = {}
  if (Array.isArray(configuration)) {
    for (let item of configuration) {
      Object.assign(obj, toObject(item['properties']))
    }
  } else if (Is.objectLiteral(configuration['properties'])) {
    obj = configuration['properties']
  }
  return obj
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
  let find = extensionRegistry.resolveExtension(filepath)
  if (find) return find.name
  if (isParentFolder(pluginRoot, filepath)) return 'coc.nvim'
}
