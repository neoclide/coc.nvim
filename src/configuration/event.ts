'use strict'
import type { ConfigurationResourceScope, ConfigurationTarget, IConfigurationChange, IConfigurationChangeEvent, IConfigurationData } from './types'
import { equals } from '../util/object'
import { Configuration } from './configuration'
import { ConfigurationModel } from './model'
import { scopeToOverrides, toValuesTree } from './util'

export class ConfigurationChangeEvent implements IConfigurationChangeEvent {

  private readonly affectedKeysTree: any
  public readonly affectedKeys: string[]
  public source: ConfigurationTarget
  // public sourceConfig: any

  constructor(public readonly change: IConfigurationChange,
    private readonly previous: IConfigurationData | undefined,
    private readonly currentConfiguration: Configuration) {
    const keysSet = new Set<string>()
    change.keys.forEach(key => keysSet.add(key))
    change.overrides.forEach(([, keys]) => keys.forEach(key => keysSet.add(key)))
    this.affectedKeys = [...keysSet.values()]

    const configurationModel = new ConfigurationModel()
    this.affectedKeys.forEach(key => configurationModel.setValue(key, {}))
    this.affectedKeysTree = configurationModel.contents
  }

  private _previousConfiguration: Configuration | undefined = undefined
  private get previousConfiguration(): Configuration | undefined {
    if (!this._previousConfiguration && this.previous) {
      this._previousConfiguration = Configuration.parse(this.previous)
    }
    return this._previousConfiguration
  }

  public affectsConfiguration(section: string, scope?: ConfigurationResourceScope): boolean {
    let overrides = scope ? scopeToOverrides(scope) : undefined
    if (this.doesAffectedKeysTreeContains(this.affectedKeysTree, section)) {
      if (overrides) {
        const value1 = this.previousConfiguration ? this.previousConfiguration.getValue(section, overrides) : undefined
        const value2 = this.currentConfiguration.getValue(section, overrides)
        return !equals(value1, value2)
      }
      return true
    }
    return false
  }

  private doesAffectedKeysTreeContains(affectedKeysTree: any, section: string): boolean {
    let requestedTree = toValuesTree({ [section]: true }, () => {})
    let key
    while (typeof requestedTree === 'object' && (key = Object.keys(requestedTree)[0])) { // Only one key should present, since we added only one property
      affectedKeysTree = affectedKeysTree[key]
      if (!affectedKeysTree) {
        return false // Requested tree is not found
      }
      requestedTree = requestedTree[key]
    }
    return true
  }
}

export class AllKeysConfigurationChangeEvent extends ConfigurationChangeEvent {
  constructor(configuration: Configuration, source: ConfigurationTarget) {
    super({ keys: configuration.allKeys(), overrides: [] }, undefined, configuration)
    this.source = source
  }
}
