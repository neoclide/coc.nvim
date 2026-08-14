'use strict'
import { setExtensionId } from '../util/extensionId'
import type { ExtensionModuleDescription } from './pathIndex'

/**
 * Maps extension identity to a coc.nvim API object.
 *
 * The factory is initialized once with the shared core API. Extension APIs
 * are created lazily and cached per extension id, so repeated
 * require("coc.nvim") calls from the same extension return the same object
 * while different extensions receive different top-level objects.
 *
 * During the first migration the per-extension wrapper is a shallow copy of
 * the shared core API: enumerable keys match the legacy API object while
 * shared subobjects such as `workspace` remain identical across extensions.
 */
export class ExtensionApiFactory<TCoreApi extends object, TExtensionApi extends object> {
  private readonly cache = new Map<string, TExtensionApi>()
  private coreApi: TCoreApi | undefined

  public initialize(coreApi: TCoreApi): void {
    if (this.coreApi) {
      throw new Error('Extension API already initialized')
    }
    this.coreApi = coreApi
  }

  public getCoreApi(): TCoreApi {
    if (!this.coreApi) {
      throw new Error('Extension API has not been initialized')
    }
    return this.coreApi
  }

  public getApi(extension: ExtensionModuleDescription): TExtensionApi {
    if (!this.coreApi) {
      throw new Error('Extension API has not been initialized')
    }
    let api = this.cache.get(extension.id)
    if (!api) {
      api = createExtensionApi(extension, this.coreApi) as unknown as TExtensionApi
      this.cache.set(extension.id, api)
    }
    return api
  }

  public delete(extensionId: string): void {
    this.cache.delete(extensionId)
  }
}

export function createExtensionApi<TCoreApi extends object>(
  extension: ExtensionModuleDescription,
  coreApi: TCoreApi
): object {
  const api = Object.assign({}, coreApi)
  const wrapped = api as { [key: string]: any }
  const extensionId = extension.id
  // Wrap registration surfaces so callbacks are tagged with the owning
  // extension id. `this` is always bound back to the shared implementation.
  if (wrapped.commands) {
    wrapped.commands = wrapApiObject(wrapped.commands, extensionId, name => {
      return name === 'registerCommand' || name === 'register'
    })
  }
  if (wrapped.events) {
    wrapped.events = wrapApiObject(wrapped.events, extensionId, name => {
      return name === 'on'
    })
  }
  if (wrapped.languages) {
    wrapped.languages = wrapApiObject(wrapped.languages, extensionId, name => {
      return name.startsWith('register')
    })
  }
  return api
}

function wrapApiObject<T extends object>(
  obj: T,
  extensionId: string,
  isRegistration: (name: string) => boolean
): T {
  if (obj == null || typeof obj !== 'object') return obj
  return new Proxy(obj, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver)
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (isRegistration(prop)) {
        return (...args: any[]) => {
          for (const arg of args) {
            if (!Array.isArray(arg)) setExtensionId(arg, extensionId)
          }
          return value.apply(target, args)
        }
      }
      return value.bind(target)
    }
  })
}
