'use strict'
import { IConfigurationModel, IOverrides, IStringDictionary } from './types'
import { distinct } from '../util/array'
import { objectLiteral } from '../util/is'
import { deepClone, deepFreeze, equals } from '../util/object'
import { addToValueTree, getConfigurationValue, removeFromValueTree } from './util'

export class ConfigurationModel implements IConfigurationModel {

  private frozen = false
  private readonly overrideConfigurations = new Map<string, ConfigurationModel>()

  constructor(
    private _contents: any = {},
    private readonly _keys: string[] = [],
    private readonly _overrides: IOverrides[] = []
  ) {}

  public get contents(): any {
    return this.checkAndFreeze(this._contents)
  }

  public get overrides(): IOverrides[] {
    return this.checkAndFreeze(this._overrides)
  }

  public get keys(): string[] {
    return this.checkAndFreeze(this._keys)
  }

  public get isFrozen(): boolean {
    return this.frozen
  }

  private checkAndFreeze<T>(data: T): T {
    if (this.frozen && !Object.isFrozen(data)) {
      return deepFreeze(data)
    }
    return data
  }

  public isEmpty(): boolean {
    return this._keys.length === 0 && Object.keys(this._contents).length === 0 && this._overrides.length === 0
  }

  public clone(): ConfigurationModel {
    return new ConfigurationModel(deepClone(this._contents), [...this.keys], deepClone(this.overrides))
  }

  public toJSON(): IConfigurationModel {
    return {
      contents: this.contents,
      overrides: this.overrides,
      keys: this.keys
    }
  }

  public getValue<V>(section?: string): V {
    let res = section
      ? getConfigurationValue<any>(this.contents, section)
      : this.contents
    return res
  }

  public getOverrideValue<V>(section: string | undefined, overrideIdentifier: string): V | undefined {
    const overrideContents = this.getContentsForOverrideIdentifier(overrideIdentifier)
    return overrideContents
      ? section ? getConfigurationValue<any>(overrideContents, section) : overrideContents
      : undefined
  }

  public getKeysForOverrideIdentifier(identifier: string): string[] {
    const keys: string[] = []
    for (const override of this.overrides) {
      if (override.identifiers.includes(identifier)) {
        keys.push(...override.keys)
      }
    }
    return distinct(keys)
  }

  public getAllOverrideIdentifiers(): string[] {
    const result: string[] = []
    for (const override of this.overrides) {
      result.push(...override.identifiers)
    }
    return distinct(result)
  }

  public override(identifier: string): ConfigurationModel {
    let overrideConfigurationModel = this.overrideConfigurations.get(identifier)
    if (!overrideConfigurationModel) {
      overrideConfigurationModel = this.createOverrideConfigurationModel(identifier)
      this.overrideConfigurations.set(identifier, overrideConfigurationModel)
    }
    return overrideConfigurationModel
  }

  public merge(...others: ConfigurationModel[]): ConfigurationModel {
    const contents = deepClone(this._contents)
    const overrides = deepClone(this._overrides)
    const keys = [...this._keys]

    for (const other of others) {
      if (other.isEmpty()) {
        continue
      }
      this.mergeContents(contents, other.contents)

      for (const otherOverride of other.overrides) {
        const [override] = overrides.filter(o => equals(o.identifiers, otherOverride.identifiers))
        if (override) {
          this.mergeContents(override.contents, otherOverride.contents)
          override.keys.push(...otherOverride.keys)
          override.keys = distinct(override.keys)
        } else {
          overrides.push(deepClone(otherOverride))
        }
      }
      for (const key of other.keys) {
        if (keys.indexOf(key) === -1) {
          keys.push(key)
        }
      }
    }
    return new ConfigurationModel(contents, keys, overrides)
  }

  public freeze(): ConfigurationModel {
    this.frozen = true
    return this
  }

  private mergeContents(source: any, target: any): void {
    for (const key of Object.keys(target)) {
      if (key in source) {
        if (objectLiteral(source[key]) && objectLiteral(target[key])) {
          this.mergeContents(source[key], target[key])
          continue
        }
      }
      source[key] = deepClone(target[key])
    }
  }

  // Update methods

  public setValue(key: string, value: any) {
    this.addKey(key)
    addToValueTree(this.contents, key, value, e => { console.error(e) })
  }

  public removeValue(key: string): void {
    if (this.removeKey(key)) {
      removeFromValueTree(this.contents, key)
    }
  }

  private addKey(key: string): void {
    let index = this.keys.length
    for (let i = 0; i < index; i++) {
      if (key.indexOf(this.keys[i]) === 0) {
        index = i
      }
    }
    this.keys.splice(index, 1, key)
  }

  private removeKey(key: string): boolean {
    const index = this.keys.indexOf(key)
    if (index !== -1) {
      this.keys.splice(index, 1)
      return true
    }
    return false
  }

  private createOverrideConfigurationModel(identifier: string): ConfigurationModel {
    const overrideContents = this.getContentsForOverrideIdentifier(identifier)

    if (!overrideContents || typeof overrideContents !== 'object' || !Object.keys(overrideContents).length) {
      // If there are no valid overrides, return self
      return this
    }

    const contents: any = {}
    for (const key of distinct([...Object.keys(this.contents), ...Object.keys(overrideContents)])) {

      let contentsForKey = this.contents[key]
      const overrideContentsForKey = overrideContents[key]

      // If there are override contents for the key, clone and merge otherwise use base contents
      if (overrideContentsForKey) {
        // Clone and merge only if base contents and override contents are of type object otherwise just override
        if (typeof contentsForKey === 'object' && typeof overrideContentsForKey === 'object') {
          contentsForKey = deepClone(contentsForKey)
          this.mergeContents(contentsForKey, overrideContentsForKey)
        } else {
          contentsForKey = overrideContentsForKey
        }
      }

      contents[key] = contentsForKey
    }

    return new ConfigurationModel(contents, this._keys, this.overrides)
  }

  private getContentsForOverrideIdentifier(identifier: string): any {
    let contentsForIdentifierOnly: IStringDictionary<any> | null = null
    let contents: IStringDictionary<any> | null = null
    const mergeContents = (contentsToMerge: any) => {
      if (contentsToMerge) {
        if (contents) {
          this.mergeContents(contents, contentsToMerge)
        } else {
          contents = deepClone(contentsToMerge)
        }
      }
    }
    for (const override of this.overrides) {
      if (equals(override.identifiers, [identifier])) {
        contentsForIdentifierOnly = override.contents
      } else if (override.identifiers.includes(identifier)) {
        mergeContents(override.contents)
      }
    }
    // Merge contents of the identifier only at the end to take precedence.
    mergeContents(contentsForIdentifierOnly)
    return contents
  }
}
