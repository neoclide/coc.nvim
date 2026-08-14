'use strict'

/**
 * Symbol used to tag registration callbacks (command handlers, event
 * listeners, language providers) with the id of the extension that
 * registered them through the per-extension API facade.
 *
 * Error and timeout diagnostics can then name the owning plugin without
 * parsing stack traces.
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

export function prefixExtensionError(error: unknown, extensionId: string): unknown {
  // Extension callbacks run inside a VM context whose intrinsic Error is not
  // the host Error constructor, so attribute by shape instead of instanceof.
  if (typeof error !== 'object' || error === null) return error
  let target = error as { message?: unknown }
  let originalMessage = ''
  try {
    if (typeof target.message === 'string') {
      originalMessage = target.message
    }
  } catch (e) {
    return error
  }
  if (originalMessage.startsWith('[extension:')) return error
  const message = `[extension: ${extensionId}] ${originalMessage}`
  try {
    target.message = message
  } catch (e) {
    return new Error(message, { cause: error })
  }
  return error
}
