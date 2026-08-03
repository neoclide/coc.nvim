'use strict'
import type { Neovim } from '@chemzqm/neovim'
import type { DocumentFilter, DocumentSelector } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import Resolver from '../model/resolver'
import { isVim } from '../util/constants'
import { onUnexpectedError } from '../util/errors'
import * as fs from '../util/fs'
import { Mutex } from '../util/mutex'
import { minimatch, os, path, semver, which } from '../util/node'
import * as platform from '../util/platform'
import { RelativePattern, TextDocumentFilter } from '../util/protocol'
let NAME_SPACE = 2000
const resolver = new Resolver()

const namespaceMap: Map<string, number> = new Map()
const mutex: Mutex = new Mutex()

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
    return semver.gte(version, convertVersion(feature.slice(6)))
  }
  return semver.gte(env.version, feature.slice(5))
}

// convert to valid semver version 9.0.0138 to 9.0.138
function convertVersion(version: string): string {
  let parts = version.split('.')
  return `${parseInt(parts[0], 10)}.${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`
}

export function callAsync<T>(nvim: Neovim, method: string, args: any[]): Promise<T> {
  return mutex.use<T>(() => {
    if (!isVim) return nvim.call(method, args) as Promise<T>
    return nvim.callAsync('coc#util#with_callback', [method, args]).catch(onUnexpectedError) as Promise<T>
  })
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
  let filepath = await nvim.call('coc#util#get_fullpath') as string
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
  let u = URI.parse(uri)
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
      let relativePattern: string
      if (RelativePattern.is(pattern)) {
        relativePattern = pattern.pattern
        let baseUri = URI.parse(typeof pattern.baseUri === 'string' ? pattern.baseUri : pattern.baseUri.uri)
        if (u.scheme !== 'file' || !fs.isParentFolder(baseUri.fsPath, u.fsPath, true)) {
          return 0
        }
      } else {
        relativePattern = pattern
      }
      let p = caseInsensitive ? relativePattern.toLowerCase() : relativePattern
      let f = caseInsensitive ? u.fsPath.toLowerCase() : u.fsPath
      if (p === f || minimatch(f, p, { dot: true })) {
        ret = Math.max(ret, 5)
      } else {
        return 0
      }
    }
    return ret
  } else {
    return 0
  }
}
