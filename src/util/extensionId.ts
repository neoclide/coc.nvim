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
