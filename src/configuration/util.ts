'use strict'
import { ParseError } from 'jsonc-parser'
import { Location, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { ConfigurationScope, ConfigurationTarget, ConfigurationUpdateTarget, ErrorItem, IConfigurationChange, IConfigurationOverrides } from '../types'
import { distinct } from '../util/array'
import { equals } from '../util/object'
const logger = require('../util/logger')('configuration-util')

export type ShowError = (errors: ErrorItem[]) => void

export interface IConfigurationCompareResult {
  added: string[]
  removed: string[]
  updated: string[]
  overrides: [string, string[]][]
}

const OVERRIDE_IDENTIFIER_PATTERN = `\\[([^\\]]+)\\]`
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, 'g')
const OVERRIDE_PROPERTY_PATTERN = `^(${OVERRIDE_IDENTIFIER_PATTERN})+$`
export const OVERRIDE_PROPERTY_REGEX = new RegExp(OVERRIDE_PROPERTY_PATTERN)

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

export function scopeToOverrides(scope: ConfigurationScope): IConfigurationOverrides {
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

export function convertErrors(uri: string, content: string, errors: ParseError[]): ErrorItem[] {
  let items: ErrorItem[] = []
  let document = TextDocument.create(uri, 'json', 0, content)
  for (let err of errors) {
    let msg = 'parse error'
    switch (err.error) {
      case 2:
        msg = 'invalid number'
        break
      case 8:
        msg = 'close brace expected'
        break
      case 5:
        msg = 'colon expected'
        break
      case 6:
        msg = 'comma expected'
        break
      case 9:
        msg = 'end of file expected'
        break
      case 16:
        msg = 'invaliad character'
        break
      case 10:
        msg = 'invalid comment token'
        break
      case 15:
        msg = 'invalid escape character'
        break
      case 1:
        msg = 'invalid symbol'
        break
      case 14:
        msg = 'invalid unicode'
        break
      case 3:
        msg = 'property name expected'
        break
      case 13:
        msg = 'unexpected end of number'
        break
      case 12:
        msg = 'unexpected end of string'
        break
      case 11:
        msg = 'unexpected end of comment'
        break
      case 4:
        msg = 'value expected'
        break
      default:
        msg = 'Unknown error'
        break
    }
    let range: Range = {
      start: document.positionAt(err.offset),
      end: document.positionAt(err.offset + err.length),
    }
    let loc = Location.create(uri, range)
    items.push({ location: loc, message: msg })
  }
  return items
}

export function toValuesTree(properties: { [qualifiedKey: string]: any }, conflictReporter: (message: string) => void): any {
  const root = Object.create(null)
  for (const key in properties) {
    addToValueTree(root, key, properties[key], conflictReporter)
  }
  return root
}

export function addToValueTree(settingsTreeRoot: any, key: string, value: any, conflictReporter: (message: string) => void): void {
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
        conflictReporter(`Ignoring ${key} as ${segments.slice(0, i + 1).join('.')} is ${JSON.stringify(obj)}`)
        return
    }
    curr = obj
  }

  if (typeof curr === 'object' && curr !== null) {
    curr[last] = value
  } else {
    conflictReporter(`Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`)
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
