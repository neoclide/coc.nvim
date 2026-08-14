'use strict'

/**
 * Symbol used to tag registration callbacks (command handlers, event
 * listeners, language providers) with the id of the extension that
 * registered them.
 *
 * The per-extension API wrapper attaches the value when an extension calls a
 * registration method, so error and timeout diagnostics can name the owning
 * plugin without parsing stack traces.
 */
export const extensionIdSymbol = Symbol.for('coc.nvim.internal.extensionId')

export function getExtensionId(target: unknown): string | undefined {
  if (typeof target === 'function' || (typeof target === 'object' && target !== null)) {
    return (target as { [key: symbol]: string | undefined })[extensionIdSymbol]
  }
  return undefined
}

export function setExtensionId(target: unknown, extensionId: string): void {
  if (typeof target === 'function' || (typeof target === 'object' && target !== null)) {
    try {
      Object.defineProperty(target, extensionIdSymbol, {
        value: extensionId,
        configurable: true,
        writable: true
      })
    } catch (e) {
      // Frozen objects cannot be tagged; attribution is best effort.
    }
  }
}

/**
 * Wrap a callback so thrown or rejected errors are prefixed with the owning
 * extension id. Used for callbacks whose invocation site is outside
 * coc.nvim's own error handling (for example protocol `Event` listeners).
 */
export function wrapCallbackWithExtension<T extends (...args: any[]) => any>(
  callback: T,
  extensionId: string
): T {
  const wrapped = function (this: unknown, ...args: any[]) {
    try {
      const res = (callback as (...a: any[]) => any).apply(this, args)
      if (res != null && typeof (res as unknown as Promise<unknown>).then === 'function') {
        return Promise.resolve(res).catch(e => {
          throw prefixExtensionError(e, extensionId)
        })
      }
      return res
    } catch (e) {
      throw prefixExtensionError(e, extensionId)
    }
  } as T
  setExtensionId(wrapped, extensionId)
  return wrapped
}

function prefixExtensionError(error: unknown, extensionId: string): unknown {
  if (error instanceof Error && !error.message.startsWith('[extension:')) {
    error.message = `[extension: ${extensionId}] ${error.message}`
  }
  return error
}
