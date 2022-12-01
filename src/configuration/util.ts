'use strict'
import { ParseError, printParseErrorCode } from 'jsonc-parser'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { distinct } from '../util/array'
import * as Is from '../util/is'
import { os } from '../util/node'
import { equals, hasOwnProperty } from '../util/object'
import { ConfigurationResourceScope, ConfigurationTarget, ConfigurationUpdateTarget, IConfigurationChange, IConfigurationOverrides } from './types'
const documentUri = 'file:///1'

export interface IConfigurationCompareResult {
  added: string[]
  removed: string[]
  updated: string[]
  overrides: [string, string[]][]
}

const OVERRIDE_IDENTIFIER_PATTERN = `\\[([^\\]]+)\\]`
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, 'g')
export const OVERRIDE_PROPERTY_PATTERN = `^(${OVERRIDE_IDENTIFIER_PATTERN})+$`
export const OVERRIDE_PROPERTY_REGEX = new RegExp(OVERRIDE_PROPERTY_PATTERN)

/**
 * Basic expand for ${env:value}, ${cwd}, ${userHome}
 */
export function expand(input: string): string {
  return input.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
    if (name.startsWith('env:')) {
      let key = name.split(':')[1]
      return process.env[key] ?? match
    }
    switch (name) {
      case 'userHome':
        return os.homedir()
      case 'cwd':
        return process.cwd()
      default:
        return match
    }
  })
}

export function expandObject(obj: any): any {
  if (obj == null) return obj
  if (typeof obj === 'string') return expand(obj)
  if (Array.isArray(obj)) return obj.map(obj => expandObject(obj))
  if (Is.objectLiteral(obj)) {
    for (let key of Object.keys(obj)) {
      obj[key] = expandObject(obj[key])
    }
    return obj
  }
  return obj
}

export function convertTarget(updateTarget: ConfigurationUpdateTarget): ConfigurationTarget {
  let target: ConfigurationTarget
  switch (updateTarget) {
    case ConfigurationUpdateTarget.Global:
      target = ConfigurationTarget.User
      break
    case ConfigurationUpdateTarget.Workspace:
      target = ConfigurationTarget.Workspace
      break
    default:
      target = ConfigurationTarget.WorkspaceFolder
  }
  return target
}

export function scopeToOverrides(scope: ConfigurationResourceScope): IConfigurationOverrides {
  let overrides: IConfigurationOverrides
  if (typeof scope === 'string') {
    overrides = { resource: scope }
  } else if (URI.isUri(scope)) {
    overrides = { resource: scope.toString() }
  } else if (scope != null) {
    let uri = scope['uri']
    let languageId = scope['languageId']
    overrides = { resource: uri, overrideIdentifier: languageId }
  }
  return overrides
}

export function overrideIdentifiersFromKey(key: string): string[] {
  const identifiers: string[] = []
  if (OVERRIDE_PROPERTY_REGEX.test(key)) {
    let matches = OVERRIDE_IDENTIFIER_REGEX.exec(key)
    while (matches?.length) {
      const identifier = matches[1].trim()
      if (identifier) {
        identifiers.push(identifier)
      }
      matches = OVERRIDE_IDENTIFIER_REGEX.exec(key)
    }
  }
  return distinct(identifiers)
}

function getOrSet<K, V>(map: Map<K, V>, key: K, value: V): V {
  let result = map.get(key)
  if (result === undefined) {
    result = value
    map.set(key, result)
  }

  return result
}

export function mergeChanges(...changes: IConfigurationChange[]): IConfigurationChange {
  if (changes.length === 0) {
    return { keys: [], overrides: [] }
  }
  if (changes.length === 1) {
    return changes[0]
  }
  const keysSet = new Set<string>()
  const overridesMap = new Map<string, Set<string>>()
  for (const change of changes) {
    change.keys.forEach(key => keysSet.add(key))
    change.overrides.forEach(([identifier, keys]) => {
      const result = getOrSet(overridesMap, identifier, new Set<string>())
      keys.forEach(key => result.add(key))
    })
  }
  const overrides: [string, string[]][] = []
  overridesMap.forEach((keys, identifier) => overrides.push([identifier, [...keys.values()]]))
  return { keys: [...keysSet.values()], overrides }
}

export function mergeConfigProperties(obj: any): any {
  let res = {}
  for (let key of Object.keys(obj)) {
    if (key.indexOf('.') == -1) {
      res[key] = obj[key]
    } else {
      let parts = key.split('.')
      let pre = res
      let len = parts.length
      for (let i = 0; i < len; i++) {
        let k = parts[i]
        if (i == len - 1) {
          pre[k] = obj[key]
        } else {
          pre[k] = pre[k] || {}
          pre = pre[k]
        }
      }
    }
  }
  return res
}

export function convertErrors(content: string, errors: ParseError[]): Diagnostic[] {
  let items: Diagnostic[] = []
  let document = TextDocument.create(documentUri, 'json', 0, content)
  for (let err of errors) {
    const range = Range.create(document.positionAt(err.offset), document.positionAt(err.offset + err.length))
    items.push(Diagnostic.create(range, printParseErrorCode(err.error), DiagnosticSeverity.Error))
  }
  return items
}

export function toValuesTree(properties: { [qualifiedKey: string]: any }, conflictReporter: (message: string) => void, doExpand = false): any {
  const root = Object.create(null)
  for (const key in properties) {
    addToValueTree(root, key, properties[key], conflictReporter, doExpand)
  }
  return root
}

export function addToValueTree(settingsTreeRoot: any, key: string, value: any, conflictReporter: (message: string) => void, doExpand = false): void {
  const segments = key.split('.')
  const last = segments.pop()!

  let curr = settingsTreeRoot
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    let obj = curr[s]
    switch (typeof obj) {
      case 'undefined':
        obj = curr[s] = Object.create(null)
        break
      case 'object':
        break
      default:
        if (conflictReporter) conflictReporter(`Ignoring ${key} as ${segments.slice(0, i + 1).join('.')} is ${JSON.stringify(obj)}`)
        return
    }
    curr = obj
  }

  if (typeof curr === 'object' && curr !== null) {
    if (doExpand) {
      curr[last] = expandObject(value)
    } else {
      curr[last] = value
    }
  } else {
    if (conflictReporter) conflictReporter(`Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`)
  }
}

export function removeFromValueTree(valueTree: any, key: string): void {
  const segments = key.split('.')
  doRemoveFromValueTree(valueTree, segments)
}

function doRemoveFromValueTree(valueTree: any, segments: string[]): void {
  const first = segments.shift()
  if (segments.length === 0) {
    // Reached last segment
    delete valueTree[first]
    return
  }

  if (Object.keys(valueTree).includes(first)) {
    const value = valueTree[first]
    if (typeof value === 'object' && !Array.isArray(value)) {
      doRemoveFromValueTree(value, segments)
      if (Object.keys(value).length === 0) {
        delete valueTree[first]
      }
    }
  }
}

export function getConfigurationValue<T>(
  config: any,
  settingPath: string,
  defaultValue?: T
): T {
  function accessSetting(config: any, path: string[]): any {
    let current = config
    for (let i = 0; i < path.length; i++) {
      if (typeof current !== 'object' || current === null) {
        return undefined
      }
      current = current[path[i]]
    }
    return current as T
  }
  const path = settingPath.split('.')
  const result = accessSetting(config, path)
  return typeof result === 'undefined' ? defaultValue : result
}

export function toJSONObject(obj: any): any {
  if (obj) {
    if (Array.isArray(obj)) {
      return obj.map(toJSONObject)
    } else if (typeof obj === 'object') {
      const res = Object.create(null)
      for (const key in obj) {
        res[key] = toJSONObject(obj[key])
      }
      return res
    }
  }
  return obj
}

/**
 * Compare too configuration contents
 */
export function compareConfigurationContents(to: { keys: string[]; contents: any } | undefined, from: { keys: string[]; contents: any } | undefined) {
  const added = to
    ? from ? to.keys.filter(key => from.keys.indexOf(key) === -1) : [...to.keys]
    : []
  const removed = from
    ? to ? from.keys.filter(key => to.keys.indexOf(key) === -1) : [...from.keys]
    : []
  const updated: string[] = []

  if (to && from) {
    for (const key of from.keys) {
      if (to.keys.indexOf(key) !== -1) {
        const value1 = getConfigurationValue(from.contents, key)
        const value2 = getConfigurationValue(to.contents, key)
        if (!equals(value1, value2)) {
          updated.push(key)
        }
      }
    }
  }
  return { added, removed, updated }
}

export function getDefaultValue(type: string | string[] | undefined): any {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const t = Array.isArray(type) ? (<string[]>type)[0] : <string>type
  switch (t) {
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    case 'string':
      return ''
    case 'array':
      return []
    case 'object':
      return {}
    default:
      return null
  }
}

export function lookUp(tree: any, key: string): any {
  if (key) {
    if (tree && hasOwnProperty(tree, key)) return tree[key]
    const parts = key.split('.')
    let node = tree
    for (let i = 0; node && i < parts.length; i++) {
      node = node[parts[i]]
    }
    return node
  }
  return tree
}
