'use strict'
import type { Neovim } from '@chemzqm/neovim'
import type { DocumentFilter, DocumentSelector } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import Resolver from '../model/resolver'
import { isVim } from '../util/constants'
import * as fs from '../util/fs'
import { minimatch, os, path, semver, which } from '../util/node'
import * as platform from '../util/platform'
import { TextDocumentFilter } from '../util/protocol'
let NAME_SPACE = 2000
const resolver = new Resolver()

const namespaceMap: Map<string, number> = new Map()

export interface PartialEnv {
  isVim: boolean
  version: string
}

/**
 * Like vim's has(), but for version check only.
 * Check patch on neovim and check nvim on vim would return false.
 *
 * For example:
 * - has('nvim-0.6.0')
 * - has('patch-7.4.248')
 */
export function has(env: PartialEnv, feature: string): boolean {
  if (!feature.startsWith('nvim-') && !feature.startsWith('patch-')) {
    throw new Error('Feature param could only starts with nvim and patch')
  }
  if (!env.isVim && feature.startsWith('patch-')) {
    return false
  }
  if (env.isVim && feature.startsWith('nvim-')) {
    return false
  }
  if (env.isVim) {
    let [_, major, minor, patch] = env.version.match(/^(\d)(\d{2})(\d+)$/)
    let version = `${major}.${parseInt(minor, 10)}.${parseInt(patch, 10)}`
    return semver.gte(version, feature.slice(6))
  }
  return semver.gte(env.version, feature.slice(5))
}

export async function callAsync<T>(nvim: Neovim, method: string, args: any[]): Promise<T> {
  if (!isVim) return await nvim.call(method, args) as T
  return await nvim.callAsync('coc#util#with_callback', [method, args]) as T
}

/**
 * @deprecated
 */
export function createNameSpace(name: string): number {
  if (namespaceMap.has(name)) return namespaceMap.get(name)
  NAME_SPACE = NAME_SPACE + 1
  namespaceMap.set(name, NAME_SPACE)
  return NAME_SPACE
}

/**
 * Resolve watchman path.
 */
export function getWatchmanPath(configurations: Configurations): string | null {
  const watchmanPath = configurations.initialConfiguration.get<string>('coc.preferences.watchmanPath', 'watchman')
  return which.sync(watchmanPath, { nothrow: true })
}

export async function findUp(nvim: Neovim, cwd: string, filename: string | string[]): Promise<string | null> {
  let filepath = await nvim.call('expand', '%:p') as string
  filepath = path.normalize(filepath)
  let isFile = filepath && path.isAbsolute(filepath)
  if (isFile && !fs.isParentFolder(cwd, filepath, true)) {
    // can't use cwd
    return fs.findUp(filename, path.dirname(filepath))
  }
  let res = fs.findUp(filename, cwd)
  if (res && res != os.homedir()) return res
  if (isFile) return fs.findUp(filename, path.dirname(filepath))
  return null
}

export function resolveModule(name: string): Promise<string> {
  return resolver.resolveModule(name)
}

export function score(selector: DocumentSelector | DocumentFilter | string, uri: string, languageId: string, caseInsensitive = platform.isWindows || platform.isMacintosh): number {
  if (Array.isArray(selector)) {
    // array -> take max individual value
    let ret = 0
    for (const filter of selector) {
      const value = score(filter, uri, languageId)
      if (value === 10) {
        return value // already at the highest
      }
      if (value > ret) {
        ret = value
      }
    }
    return ret
  } else if (typeof selector === 'string') {
    // short-hand notion, desugars to
    // 'fooLang' -> { language: 'fooLang'}
    // '*' -> { language: '*' }
    if (selector === '*') {
      return 5
    } else if (selector === languageId) {
      return 10
    } else {
      return 0
    }
  } else if (selector && TextDocumentFilter.is(selector)) {
    let u = URI.parse(uri)
    // filter -> select accordingly, use defaults for scheme
    const { language, pattern, scheme } = selector
    let ret = 0
    if (scheme) {
      if (scheme === u.scheme) {
        ret = 5
      } else if (scheme === '*') {
        ret = 3
      } else {
        return 0
      }
    }

    if (language) {
      if (language === languageId) {
        ret = 10
      } else if (language === '*') {
        ret = Math.max(ret, 5)
      } else {
        return 0
      }
    }

    if (pattern) {
      let p = caseInsensitive ? pattern.toLowerCase() : pattern
      let f = caseInsensitive ? u.fsPath.toLowerCase() : u.fsPath
      if (p === f || minimatch(f, p, { dot: true })) {
        ret = 5
      } else {
        return 0
      }
    }

    return ret
  } else {
    return 0
  }
}
