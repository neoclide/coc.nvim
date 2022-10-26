'use strict'
import path from 'path'
import { isParentFolder, sameFile } from './fs'
import { Registry } from './registry'

const PLUGIN_ROOT = global.__TEST__ ? path.resolve(__dirname, '../..') : path.dirname(__dirname)
/**
 * Contains static extension infos
 */
export const Extensions = {
  ExtensionContribution: 'base.contributions.extensions'
}

export interface IExtensionInfo {
  readonly name: string,
  readonly directory: string,
  readonly filepath?: string
}

export interface IExtensionContributions {
  extensions: Iterable<IExtensionInfo>
}

export interface IExtensionRegistry {

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

class ExtensionRegistry implements IExtensionRegistry {
  private extensionsById: Map<string, IExtensionInfo>

  constructor() {
    this.extensionsById = new Map()
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
  let find = arr.find(o => sameFile(o.filepath, filepath))
  if (find) return find.name
  find = arr.find(o => isParentFolder(o.directory, filepath))
  if (find) return find.name
  if (isParentFolder(PLUGIN_ROOT, filepath)) return 'coc.nvim'
}
