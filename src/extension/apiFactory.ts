'use strict'
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
  return Object.assign({}, coreApi)
}
