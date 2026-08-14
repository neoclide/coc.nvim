'use strict'
import { getExtensionId, setExtensionId, wrapCallbackWithExtension } from '../util/extensionId'
import type { Disposable } from '../util/protocol'

/**
 * Per-extension coc.nvim API facade.
 *
 * Every extension runtime owns exactly one facade. Mutable core singletons
 * (workspace, commands, languages, ...) are wrapped so extensions never
 * receive the raw manager objects: registration callbacks are tagged with the
 * owning extension id (error and timeout diagnostics can name the plugin
 * without parsing stack traces) and non-registration methods are bound back
 * to the shared implementation. Immutable value exports are shared directly.
 */

export interface ExtensionApiContext {
  extensionId: string
  extensionRoot: string
  subscriptions: Disposable[]
}

/**
 * Track an extension-owned registration so it can be disposed together with
 * the extension runtime.
 */
export function trackExtensionDisposable<T extends Disposable>(context: ExtensionApiContext, disposable: T): T {
  context.subscriptions.push(disposable)
  return disposable
}

/**
 * Mutable singleton exports that must be wrapped per extension.
 */
export const WRAPPED_SINGLETONS = [
  'workspace',
  'window',
  'snippetManager',
  'events',
  'services',
  'commands',
  'sources',
  'mcp',
  'languages',
  'diagnosticManager',
  'extensions',
  'listManager',
] as const

/**
 * Immutable / value exports shared directly across extensions. Every export
 * added to src/index.ts must be classified here or in WRAPPED_SINGLETONS.
 */
export const SHARED_VALUE_EXPORTS = [
  'Uri',
  'LineBuilder',
  'NullLogger',
  'SettingMonitor',
  'LanguageClient',
  'CancellationTokenSource',
  'ProgressType',
  'RequestType',
  'RequestType0',
  'NotificationType',
  'NotificationType0',
  'ProtocolRequestType',
  'ProtocolRequestType0',
  'ProtocolNotificationType',
  'ProtocolNotificationType0',
  'Highlighter',
  'Mru',
  'Emitter',
  'SnippetString',
  'BasicList',
  'Mutex',
  'TreeItem',
  'SemanticTokensBuilder',
  'FloatFactory',
  'RelativePattern',
  'CancellationError',
  'WorkspaceChange',
  'ResponseError',
  'StringValue',
  'SnippetTextEdit',
  'Trace',
  'DocumentUri',
  'WorkspaceFolder',
  'SelectedCompletionInfo',
  'InlineCompletionContext',
  'InlineCompletionItem',
  'InlineCompletionList',
  'InlineCompletionTriggerKind',
  'InlineValueText',
  'InlineValueVariableLookup',
  'InlineValueEvaluatableExpression',
  'InlineValueContext',
  'InlayHintKind',
  'InlayHintLabelPart',
  'InlayHint',
  'DiagnosticRelatedInformation',
  'SemanticTokens',
  'SemanticTokenTypes',
  'SemanticTokenModifiers',
  'AnnotatedTextEdit',
  'ChangeAnnotation',
  'SymbolTag',
  'Command',
  'Color',
  'CodeDescription',
  'ColorInformation',
  'ColorPresentation',
  'TextDocumentEdit',
  'TextDocumentIdentifier',
  'VersionedTextDocumentIdentifier',
  'TextDocumentItem',
  'DocumentHighlight',
  'SelectionRange',
  'DocumentLink',
  'CodeLens',
  'FormattingOptions',
  'CodeAction',
  'CodeActionContext',
  'DocumentSymbol',
  'WorkspaceSymbol',
  'CreateFile',
  'RenameFile',
  'WorkspaceEdit',
  'InsertReplaceEdit',
  'InsertTextMode',
  'CompletionItem',
  'CompletionList',
  'Hover',
  'ParameterInformation',
  'SignatureInformation',
  'SymbolInformation',
  'MarkupContent',
  'ErrorCodes',
  'EOL',
  'ExtensionType',
  'CompletionItemTag',
  'integer',
  'uinteger',
  'FoldingRangeKind',
  'FoldingRange',
  'ChangeAnnotationIdentifier',
  'DeleteFile',
  'OptionalVersionedTextDocumentIdentifier',
  'CompletionItemLabelDetails',
  'MarkedString',
  'ProviderName',
  'DocumentDiagnosticReportKind',
  'UniquenessLevel',
  'MonikerKind',
  'PatternType',
  'SourceType',
  'ConfigurationTarget',
  'ServiceStat',
  'FileType',
  'State',
  'ClientState',
  'CloseAction',
  'ErrorAction',
  'TransportKind',
  'MessageTransports',
  'RevealOutputChannelOn',
  'MarkupKind',
  'DiagnosticTag',
  'DocumentHighlightKind',
  'SymbolKind',
  'SignatureHelpTriggerKind',
  'FileChangeType',
  'CodeActionKind',
  'CodeActionTriggerKind',
  'CompletionTriggerKind',
  'Diagnostic',
  'DiagnosticSeverity',
  'CompletionItemKind',
  'InsertTextFormat',
  'Location',
  'LocationLink',
  'CancellationToken',
  'Position',
  'Range',
  'TextEdit',
  'Disposable',
  'Event',
  'TreeItemCollapsibleState',
  'DiagnosticPullMode',
  'ApplyKind',
  'terminate',
  'fetch',
  'download',
  'ansiparse',
  'disposeAll',
  'concurrent',
  'watchFile',
  'wait',
  'runCommand',
  'isRunning',
  'executable',
] as const

const WORKSPACE_REGISTRATION_METHODS = new Set([
  'registerKeymap',
  'registerExprKeymap',
  'registerInsertKeymap',
  'registerLocalKeymap',
  'registerBufferSync',
  'registerAutocmd',
  'registerTextDocumentContentProvider',
  'createFileSystemWatcher',
])

function isRegistrationMethod(singletonName: string, name: string): boolean {
  if (name.startsWith('register')) return true
  if (singletonName === 'events') {
    return name === 'on' || name === 'once'
  }
  if (singletonName === 'sources') {
    return name === 'addSource' || name === 'removeSource'
  }
  if (singletonName === 'diagnosticManager') {
    return name === 'create' || name === 'createDiagnosticCollection'
  }
  if (singletonName === 'workspace') {
    return name.startsWith('onDid') || name.startsWith('onWill') || WORKSPACE_REGISTRATION_METHODS.has(name)
  }
  return false
}

/**
 * Wrap callbacks nested inside workspace registration objects (autocmd
 * options, textDocumentContent providers) so errors thrown by them carry the
 * owning extension id.
 */
function wrapNestedCallbacks(obj: any, extensionId: string): void {
  for (let key of ['callback', 'provideTextDocumentContent']) {
    let fn = obj[key]
    if (typeof fn === 'function' && getExtensionId(fn) == null) {
      obj[key] = wrapCallbackWithExtension(fn, extensionId)
    }
  }
}

function createWrappedFacade(context: ExtensionApiContext, core: any, singletonName: string): any {
  const wrapFunctions = singletonName === 'workspace'
  return new Proxy(core, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver)
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (isRegistrationMethod(singletonName, prop)) {
        return (...args: any[]) => {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (Array.isArray(arg)) continue
            if (typeof arg === 'function') {
              if (wrapFunctions) {
                args[i] = wrapCallbackWithExtension(arg, context.extensionId)
              } else {
                setExtensionId(arg, context.extensionId)
              }
              continue
            }
            if (arg != null && typeof arg === 'object') {
              setExtensionId(arg, context.extensionId)
              if (wrapFunctions) {
                wrapNestedCallbacks(arg, context.extensionId)
              }
            }
          }
          let result = value.apply(target, args)
          if (result != null && typeof result.dispose === 'function') {
            trackExtensionDisposable(context, result)
          }
          return result
        }
      }
      return value.bind(target)
    },
    set() {
      // Facade objects are read-only: mutating one extension's facade must
      // never leak into the shared core singleton or another extension.
      return false
    }
  })
}

/**
 * Build one immutable top-level API facade for an extension runtime.
 */
export function createExtensionApi(context: ExtensionApiContext, core: any): any {
  const api: any = {}
  Object.defineProperty(api, 'nvim', {
    enumerable: true,
    configurable: false,
    get: () => core?.workspace?.nvim
  })
  for (const name of WRAPPED_SINGLETONS) {
    if (core && core[name] != null) {
      api[name] = createWrappedFacade(context, core[name], name)
    }
  }
  for (const name of SHARED_VALUE_EXPORTS) {
    if (core && name in core) {
      api[name] = core[name]
    }
  }
  return Object.freeze(api)
}
