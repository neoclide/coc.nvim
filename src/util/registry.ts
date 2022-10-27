import type { IConfigurationPropertySchema } from '../configuration/registry'
import { ConfigurationScope, IStringDictionary } from '../types'
import { assert } from './errors'
import { objectLiteral } from './is'
import { deepClone, toObject } from './object'

export interface IRegistry {

  /**
   * Adds the extension functions and properties defined by data to the
   * platform. The provided id must be unique.
   *
   * @param id a unique identifier
   * @param data a contribution
   */
  add(id: string, data: any): void

  /**
   * Returns true iff there is an extension with the provided id.
   *
   * @param id an extension identifier
   */
  knows(id: string): boolean

  /**
   * Returns the extension functions and properties defined by the specified key or null.
   *
   * @param id an extension identifier
   */
  as<T>(id: string): T
}

class RegistryImpl implements IRegistry {

  private readonly data = new Map<string, any>()

  public add(id: string, data: any): void {
    assert(typeof id === 'string')
    assert(objectLiteral(data))
    assert(!this.data.has(id))
    this.data.set(id, data)
  }

  public knows(id: string): boolean {
    return this.data.has(id)
  }

  public as(id: string): any {
    return this.data.get(id) || null
  }
}

export const Registry: IRegistry = new RegistryImpl()

function convertScope(scope: string, defaultScope = ConfigurationScope.WINDOW): ConfigurationScope {
  if (scope === 'application' || scope === 'window') return ConfigurationScope.WINDOW
  if (scope === 'resource' || scope === 'machine-overridable') return ConfigurationScope.RESOURCE
  if (scope === 'language-overridable') return ConfigurationScope.LANGUAGE_OVERRIDABLE
  return defaultScope
}

/**
 * Properties to schema
 */
export function convertProperties(properties: object | null | undefined, defaultScope = ConfigurationScope.WINDOW): IStringDictionary<IConfigurationPropertySchema> {
  let obj: IStringDictionary<IConfigurationPropertySchema> = {}
  for (let [key, def] of Object.entries(toObject(properties))) {
    let data = deepClone(def)
    data.scope = convertScope(def.scope, defaultScope)
    obj[key] = data
  }
  return obj
}
