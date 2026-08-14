'use strict'
import Module from 'node:module'
import type { ExtensionApiFactory } from './apiFactory'
import { isInside, type ExtensionPathIndex } from './pathIndex'

type ModuleWithLoad = typeof Module & {
  _load(
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean
  ): unknown
}

const NodeModule = Module as ModuleWithLoad

/**
 * `Module._load` wrapper that maps `require("coc.nvim")` to the API of the
 * importing extension.
 *
 * Only the exact request `coc.nvim` is special-cased; every other request
 * delegates to Node's original loader. Production runs exactly one
 * `ExtensionManager`, so one wrapper is installed for the process lifetime;
 * each manager installs its own wrapper and chains to any previous one, so
 * the most recently installed wrapper owns `coc.nvim` resolution. Extension
 * reloads never install another wrapper. Unknown importers fail with a
 * diagnostic error instead of silently receiving an arbitrary API.
 */
export class CocModuleInterceptor<TCoreApi extends object, TExtensionApi extends object> {
  private installed = false
  private originalLoad: ModuleWithLoad['_load'] | undefined
  private wrappedLoad: ModuleWithLoad['_load'] | undefined

  constructor(
    private readonly paths: ExtensionPathIndex,
    private readonly apiFactory: ExtensionApiFactory<TCoreApi, TExtensionApi>,
    private readonly cocRoot: string
  ) {}

  public install(): void {
    if (this.installed) return
    const originalLoad = NodeModule._load
    const loadApi = this.loadApi.bind(this)
    function wrappedLoad(
      this: unknown,
      request: string,
      parent: NodeModule | undefined,
      isMain: boolean
    ): unknown {
      if (request !== 'coc.nvim') {
        return Reflect.apply(originalLoad, this, arguments)
      }
      return loadApi(parent)
    }
    this.originalLoad = originalLoad
    this.wrappedLoad = wrappedLoad
    NodeModule._load = wrappedLoad
    this.installed = true
  }

  /**
   * Tests only. Restores the original loader unless a newer wrapper has been
   * installed by another subsystem.
   */
  public dispose(): void {
    if (!this.installed) return
    if (NodeModule._load === this.wrappedLoad && this.originalLoad) {
      NodeModule._load = this.originalLoad
    }
    this.installed = false
    this.originalLoad = undefined
    this.wrappedLoad = undefined
  }

  private loadApi(parent: NodeModule | undefined): TCoreApi | TExtensionApi {
    const filename = parent?.filename
    if (!filename) {
      throw new Error('Cannot resolve "coc.nvim" API owner: parent module is missing')
    }
    const extension = this.paths.findByFile(filename)
    if (extension) {
      return this.apiFactory.getApi(extension)
    }
    if (isInside(this.cocRoot, filename)) {
      return this.apiFactory.getCoreApi()
    }
    throw new Error(
      'Cannot resolve "coc.nvim" API owner.\n\n' +
      `Importer:\n  ${filename}\n\n` +
      'The importing module does not belong to coc.nvim core or a registered extension.'
    )
  }
}
