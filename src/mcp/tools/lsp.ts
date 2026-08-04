'use strict'
import {
  CodeAction,
  CodeActionContext,
  CodeActionTriggerKind,
  Diagnostic,
  DocumentSymbol,
  Hover,
  MarkupContent,
  Position,
  Range,
  SignatureHelp,
  SymbolKind,
  WorkspaceSymbol
} from 'vscode-languageserver-types'
import { LSPErrorCodes, ResponseError, SignatureHelpTriggerKind } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import diagnosticManager from '../../diagnostic/manager'
import languages, { ProviderName } from '../../languages'
import { createLogger } from '../../logger'
import type Document from '../../model/document'
import { asDocumentSymbolTree } from '../../provider/documentSymbolManager'
import services from '../../services'
import { CancellationToken, Disposable, Trace } from '../../util/protocol'
import { LocationWithTarget } from '../../types'
import { equals } from '../../util/object'
import workspace from '../../workspace'
import { McpTool, McpToolResult, ToolContext } from './index'
import { QueryCache } from './queryCache'
import { collectEditUris, errorResult, resolveDocument, textResult } from './util'
const logger = createLogger('mcp-lsp')

const MAX_RESULTS_HARD_LIMIT = 1000
const QUERY_CACHE_TTL_MS = 5000
const QUERY_CACHE_MAX_ENTRIES = 200

/**
 * Bound for abandoned LSP requests per server when
 * `mcp.maxConcurrentRequests` is 0 (unlimited concurrency): requests a hung
 * server never answers are tracked as stuck, and new queries fail fast once
 * this many accumulate instead of being sent and abandoned forever.
 */
export const MAX_STUCK_REQUESTS = 16

export function maxResultsFromArgs(args: any, fallback: number): number {
  let n = args?.maxResults
  if (typeof n !== 'number' || !isFinite(n)) return fallback
  return Math.min(Math.max(1, Math.floor(n)), MAX_RESULTS_HARD_LIMIT)
}

interface LimitedList<T> {
  items: T[]
  total: number
  truncated: boolean
}

export function limitResults<T>(list: T[] | null | undefined, maxResults: number): LimitedList<T> {
  let all = Array.isArray(list) ? list : []
  if (all.length > maxResults) {
    return { items: all.slice(0, maxResults), total: all.length, truncated: true }
  }
  return { items: all, total: all.length, truncated: false }
}

export function positionFromArgs(args: any, key = 'position'): Position | null {
  let p = args?.[key]
  if (!p || typeof p.line !== 'number' || typeof p.character !== 'number') return null
  return Position.create(p.line, p.character)
}

export function rangeFromArgs(args: any, key = 'range'): Range | null {
  let r = args?.[key]
  if (!r || !r.start || !r.end) return null
  let start = positionFromArgs(r, 'start')
  let end = positionFromArgs(r, 'end')
  if (!start || !end) return null
  return Range.create(start, end)
}

export function fullRange(doc: Document): Range {
  const end = Position.create(doc.lineCount, 0)
  return Range.create(Position.create(0, 0), end)
}

export function hasProvider(name: ProviderName, doc: Document): boolean {
  try {
    return languages.hasProvider(name, doc.textDocument)
  } catch (_e) {
    return false
  }
}

interface PositionedDoc {
  doc?: Document
  uri: string
  position?: Position
  error?: string
}

export async function resolvePositionedDoc(args: any): Promise<PositionedDoc> {
  let ref = await resolveDocument(args?.uri, true)
  if (ref.error) return { doc: undefined, uri: ref.uri, error: ref.error }
  let doc = ref.doc!
  let pos = positionFromArgs(args)
  if (!pos) return { doc, uri: ref.uri, error: 'position {line, character} is required' }
  doc._forceSync()
  return { doc, uri: ref.uri, position: pos }
}

export function locationText(label: string, items: any[], limited?: LimitedList<any>): string {
  if (items.length === 0) return `${label}: no results`
  let lines = items.map((item, index) => {
    let pos = item.range?.start
    let where = pos ? `${pos.line + 1}:${pos.character + 1}` : ''
    return `${index + 1}. ${item.uri} ${where}`
  })
  let shown = `${items.length} result${items.length > 1 ? 's' : ''}`
  if (limited && limited.total > items.length) shown = `${items.length} of ${limited.total} results`
  let suffix = limited?.truncated ? ' (truncated: raise maxResults to return more)' : ''
  return `${label}: ${shown}${suffix}\n${lines.join('\n')}`
}

/**
 * Normalize an LSP location response (Location / LocationLink, single or
 * array) into the LocationWithTarget shape used by the tools, deduping by
 * uri + range like the provider managers do.
 */
export function normalizeLocations(result: any): LocationWithTarget[] {
  let locations: LocationWithTarget[] = []
  let list = Array.isArray(result) ? result : result ? [result] : []
  for (let loc of list) {
    if (!loc || typeof loc !== 'object') continue
    if (typeof loc.targetUri === 'string') {
      // LocationLink
      let item: LocationWithTarget = { uri: loc.targetUri, range: loc.targetSelectionRange ?? loc.targetRange }
      if (loc.targetRange) item.targetRange = loc.targetRange
      if (locations.find(o => o.uri === item.uri && equals(o.range, item.range))) continue
      locations.push(item)
    } else if (typeof loc.uri === 'string' && loc.range) {
      if (locations.find(o => o.uri === loc.uri && equals(o.range, loc.range))) continue
      locations.push({ uri: loc.uri, range: loc.range })
    }
  }
  return locations
}

/**
 * Language server id configured for a document's languageId via
 * `mcp.languageServiceMap`. Returns undefined to fall back to the regular
 * provider aggregation.
 */
export function configuredServiceId(doc: Document): string | undefined {
  let config = workspace.getConfiguration('mcp')
  let map = config.get<Record<string, string>>('languageServiceMap', {})
  let id = map[doc.languageId]
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * The agent should not generate LSP trace output: with trace enabled the
 * client serializes every request/response into the output channel, which
 * adds noticeable overhead to agent queries. Disable the trace on the
 * language server configured for the document via `mcp.languageServiceMap`
 * only; without a mapping nothing is touched. The setter is idempotent and
 * re-sending `$/setTrace` is avoided once the trace is already off.
 */
export function disableLanguageTrace(doc: Document): void {
  let serviceId = configuredServiceId(doc)
  if (!serviceId) return
  let service = services.getService(serviceId)
  if (service?.client) service.client.trace = Trace.Off
}

/**
 * Short-TTL LRU cache for idempotent LSP queries, keyed by document uri,
 * query variant (method + configured service), document version and
 * position. Repeated agent queries at the same spot (Codex re-queries the
 * same symbol often) are served from the cache. Entries are dropped when
 * the document changes or the buffer closes, and otherwise expire after a
 * few seconds.
 */
export const lspQueryCache = new QueryCache<any>({
  maxEntries: QUERY_CACHE_MAX_ENTRIES,
  ttlMs: QUERY_CACHE_TTL_MS
})

export function queryCacheKey(variant: string, doc: Document, pos: Position | null): string {
  let version = doc.version
  if (pos) {
    return `${doc.uri}\0${variant}\0${version}\0${pos.line}\0${pos.character}`
  }
  return `${doc.uri}\0${variant}\0${version}\0-1\0-1`
}

function queryVariant(method: string, serviceId: string | undefined): string {
  return `${method}:${serviceId ?? ''}`
}

function isErrorResult(result: any): boolean {
  return result && typeof result === 'object' && 'error' in result
}

async function withQueryCache<T>(variant: string, doc: Document, pos: Position | null, fetch: () => Promise<T>): Promise<T> {
  let key = queryCacheKey(variant, doc, pos)
  let cached = lspQueryCache.get(key)
  if (cached !== undefined) return cached
  let result = await fetch()
  if (!isErrorResult(result)) lspQueryCache.set(key, result)
  return result
}

export function invalidateLspQueryCache(uri: string): void {
  lspQueryCache.deleteUri(uri)
}

// document changes invalidate cached results so they can never go stale
workspace.onDidChangeTextDocument(e => invalidateLspQueryCache(e.textDocument.uri))
workspace.onDidCloseTextDocument(doc => invalidateLspQueryCache(doc.uri))

/**
 * Per-service semaphore limiting how many LSP requests are in flight to one
 * language server at the same time. Different servers have different
 * capacity, so the limit is configurable (`mcp.maxConcurrentRequests`,
 * 0 = unlimited). When an MCP request is abandoned (timeout or
 * notifications/cancelled) its queued task is dropped so abandoned calls
 * cannot pile up, and a task that is already running counts as stuck until
 * the language server actually responds. With `limit <= 0` there is no
 * concurrency cap, but queued-task dropping and stuck tracking still apply.
 */
interface WaitingTask {
  run: () => void
  cancelled: boolean
}

export class ServiceLimiter {
  private active = 0
  private waiting: WaitingTask[] = []
  private abandoned = 0

  constructor(public limit: number) {}

  /**
   * Running requests that were cancelled but have not settled yet. When
   * every slot is occupied by stuck requests the language server is
   * effectively unresponsive, so new queries fail fast instead of queueing
   * behind them forever.
   */
  public get stuckCount(): number {
    return this.abandoned
  }

  public run<T>(fn: () => Promise<T>, token?: CancellationToken): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (token?.isCancellationRequested) {
        reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'))
        return
      }
      let task: WaitingTask = { cancelled: false, run: () => {} }
      let settled = false
      let stuck = false
      let disposable: Disposable | undefined
      if (token) {
        disposable = token.onCancellationRequested(() => {
          if (task.cancelled || settled) return
          task.cancelled = true
          let idx = this.waiting.indexOf(task)
          if (idx !== -1) {
            // still queued: drop it so abandoned MCP calls do not pile up
            this.waiting.splice(idx, 1)
            if (disposable) disposable.dispose()
            reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'))
          } else {
            // already running: the server still holds the request, count it
            // as stuck until it settles
            this.abandoned++
            stuck = true
          }
        })
      }
      task.run = () => {
        let cleanup = (): void => {
          settled = true
          this.active--
          if (stuck) this.abandoned--
          if (disposable) disposable.dispose()
          this.pump()
        }
        Promise.resolve()
          .then(fn)
          .then(
            value => {
              cleanup()
              resolve(value)
            },
            error => {
              cleanup()
              reject(error)
            }
          )
      }
      this.waiting.push(task)
      this.pump()
    })
  }

  private pump(): void {
    while ((this.limit <= 0 || this.active < this.limit) && this.waiting.length > 0) {
      this.active++
      this.waiting.shift()!.run()
    }
  }
}

const serviceLimiters = new Map<string, ServiceLimiter>()

export function getServiceLimiter(serviceId: string, limit: number): ServiceLimiter {
  let limiter = serviceLimiters.get(serviceId)
  if (!limiter) {
    limiter = new ServiceLimiter(limit)
    serviceLimiters.set(serviceId, limiter)
  } else {
    limiter.limit = limit
  }
  return limiter
}

/**
 * Run `fn` under the per-service concurrency limit for `serviceId`.
 * `limit <= 0` disables the limit but still tracks abandoned requests as
 * stuck. When `token` is cancelled a queued request is dropped and a
 * running one is tracked as stuck (see `ServiceLimiter`).
 */
export function withServiceLimit<T>(serviceId: string, limit: number, fn: () => Promise<T>, token?: CancellationToken): Promise<T> {
  return getServiceLimiter(serviceId, limit).run(fn, token)
}

/**
 * Send an LSP request directly to the given service, bypassing the provider
 * aggregation. Returns an error string when the service is missing or the
 * request failed.
 */
export async function serviceCall(
  serviceId: string,
  method: string,
  params: any,
  token: CancellationToken
): Promise<{ result?: any, error?: string }> {
  let service = services.getService(serviceId)
  if (!service || !service.client) return { error: `Language server "${serviceId}" not found or not running` }
  service.client.trace = Trace.Off
  let limit = workspace.getConfiguration('mcp').get<number>('maxConcurrentRequests', 4)
  let limiter = getServiceLimiter(serviceId, limit)
  let maxStuck = limit > 0 ? limiter.limit : MAX_STUCK_REQUESTS
  if (limiter.stuckCount >= maxStuck) {
    return {
      error: `Language server "${serviceId}" has ${limiter.stuckCount} stuck requests, new queries rejected. Restart the language server to recover.`
    }
  }
  try {
    let result = await withServiceLimit(serviceId, limit, () => services.sendRequest(serviceId, method, params, token), token)
    return { result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

interface LocationQuery {
  provider: ProviderName
  label: string
  cacheKey: string
  fetch: (doc: Document, pos: Position, token: CancellationToken) => Promise<LocationWithTarget[]>
  serviceMethod: string
  buildParams: (doc: Document, pos: Position) => any
}

export const LOCATION_QUERIES: Record<string, LocationQuery> = {
  definition: {
    provider: ProviderName.Definition,
    label: 'Definition',
    cacheKey: 'definition',
    fetch: (doc, pos, token) => languages.getDefinition(doc.textDocument, pos, token),
    serviceMethod: 'textDocument/definition',
    buildParams: (doc, pos) => ({ textDocument: { uri: doc.uri }, position: pos })
  },
  declaration: {
    provider: ProviderName.Declaration,
    label: 'Declaration',
    cacheKey: 'declaration',
    fetch: (doc, pos, token) => languages.getDeclaration(doc.textDocument, pos, token),
    serviceMethod: 'textDocument/declaration',
    buildParams: (doc, pos) => ({ textDocument: { uri: doc.uri }, position: pos })
  },
  type_definition: {
    provider: ProviderName.TypeDefinition,
    label: 'Type definition',
    cacheKey: 'type_definition',
    fetch: (doc, pos, token) => languages.getTypeDefinition(doc.textDocument, pos, token),
    serviceMethod: 'textDocument/typeDefinition',
    buildParams: (doc, pos) => ({ textDocument: { uri: doc.uri }, position: pos })
  },
  implementation: {
    provider: ProviderName.Implementation,
    label: 'Implementation',
    cacheKey: 'implementation',
    fetch: (doc, pos, token) => languages.getImplementation(doc.textDocument, pos, token),
    serviceMethod: 'textDocument/implementation',
    buildParams: (doc, pos) => ({ textDocument: { uri: doc.uri }, position: pos })
  }
}

export function referencesQuery(includeDeclaration: boolean): LocationQuery {
  return {
    provider: ProviderName.Reference,
    label: 'References',
    cacheKey: `references:${includeDeclaration}`,
    fetch: (doc, pos, token) => languages.getReferences(doc.textDocument, { includeDeclaration }, pos, token),
    serviceMethod: 'textDocument/references',
    buildParams: (doc, pos) => ({
      textDocument: { uri: doc.uri },
      position: pos,
      context: { includeDeclaration }
    })
  }
}

/**
 * Fetch locations for one query, either from the configured service or the
 * aggregated providers. Returns `{ error }` on failure so callers can
 * decide how to present it.
 */
export async function getLocationResult(
  doc: Document,
  pos: Position,
  serviceId: string | undefined,
  query: LocationQuery,
  token: CancellationToken
): Promise<{ locations: LocationWithTarget[] } | { error: string }> {
  disableLanguageTrace(doc)
  return withQueryCache(queryVariant(query.cacheKey, serviceId), doc, pos, async () => {
    if (serviceId) {
      let call = await serviceCall(serviceId, query.serviceMethod, query.buildParams(doc, pos), token)
      if (call.error) return { error: `${query.label} request failed: ${call.error}` }
      return { locations: normalizeLocations(call.result) }
    }
    if (!hasProvider(query.provider, doc)) {
      return { error: `${query.label} provider not found for ${doc.uri}` }
    }
    try {
      return { locations: await query.fetch(doc, pos, token) }
    } catch (e) {
      logger.error(`${query.label} request failed`, e)
      return { error: `${query.label} request failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
}

/**
 * Shared location result body (truncated, uri + range only) used by the
 * individual tools and lsp/batch.
 */
export async function locationResultBody(
  doc: Document,
  pos: Position,
  serviceId: string | undefined,
  query: LocationQuery,
  maxResults: number,
  token: CancellationToken
): Promise<{ count: number, returned: number, truncated: boolean, locations: any[] } | { error: string }> {
  let res = await getLocationResult(doc, pos, serviceId, query, token)
  if ('error' in res) return res
  let limited = limitResults(res.locations, maxResults)
  let items = limited.items.map(loc => ({ uri: loc.uri, range: loc.range }))
  return { count: limited.total, returned: items.length, truncated: limited.truncated, locations: items }
}

export async function locationTool(
  args: any,
  context: ToolContext,
  query: LocationQuery,
  defaultMaxResults = 200
): Promise<McpToolResult> {
  let r = await resolvePositionedDoc(args)
  if (r.error) return errorResult(r.error)
  let doc = r.doc!
  let pos = r.position!
  let body = await locationResultBody(doc, pos, configuredServiceId(doc), query, maxResultsFromArgs(args, defaultMaxResults), context.token)
  if ('error' in body) return errorResult(body.error)
  let result = { uri: doc.uri, position: pos, ...body }
  return textResult(locationText(query.label, body.locations, { items: body.locations, total: body.count, truncated: body.truncated }), result)
}

export function hoverContents(contents: any): string[] {
  let list = Array.isArray(contents) ? contents : [contents]
  let parts: string[] = []
  for (let item of list) {
    if (typeof item === 'string') {
      parts.push(item)
    } else if (item && typeof item === 'object') {
      let markdown = item as MarkupContent
      if (typeof markdown.value === 'string') {
        parts.push(markdown.value)
      } else if (typeof (item as any).value === 'string') {
        parts.push((item as any).value)
      }
    }
  }
  return parts
}

export function hoverSummary(hover: Hover): any {
  return {
    contents: hoverContents(hover.contents),
    range: hover.range
  }
}

export async function getHoverResult(
  doc: Document,
  pos: Position,
  serviceId: string | undefined,
  token: CancellationToken
): Promise<{ hovers: Hover[] } | { error: string }> {
  disableLanguageTrace(doc)
  return withQueryCache(queryVariant('hover', serviceId), doc, pos, async () => {
    if (serviceId) {
      let call = await serviceCall(serviceId, 'textDocument/hover', { textDocument: { uri: doc.uri }, position: pos }, token)
      if (call.error) return { error: `Hover request failed: ${call.error}` }
      return { hovers: call.result ? [call.result] : [] }
    }
    if (!hasProvider(ProviderName.Hover, doc)) return { error: `Hover provider not found for ${doc.uri}` }
    try {
      return { hovers: await languages.getHover(doc.textDocument, pos, token) }
    } catch (e) {
      return { error: `Hover request failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
}

export function signatureSummary(help?: SignatureHelp): any {
  return {
    activeSignature: help?.activeSignature ?? -1,
    activeParameter: help?.activeParameter ?? -1,
    signatures: (help?.signatures || []).map(s => ({
      label: s.label,
      documentation: typeof s.documentation === 'string' ? s.documentation : (s.documentation as MarkupContent)?.value,
      parameters: (s.parameters || []).map(p => ({
        label: p.label,
        documentation: typeof p.documentation === 'string' ? p.documentation : (p.documentation as MarkupContent)?.value
      }))
    }))
  }
}

export async function getSignatureResult(
  doc: Document,
  pos: Position,
  serviceId: string | undefined,
  token: CancellationToken
): Promise<{ help?: SignatureHelp } | { error: string }> {
  disableLanguageTrace(doc)
  return withQueryCache(queryVariant('signature_help', serviceId), doc, pos, async () => {
    if (serviceId) {
      let call = await serviceCall(serviceId, 'textDocument/signatureHelp', {
        textDocument: { uri: doc.uri },
        position: pos,
        context: { triggerKind: SignatureHelpTriggerKind.Invoked, isRetrigger: false }
      }, token)
      if (call.error) return { error: `Signature help request failed: ${call.error}` }
      return { help: call.result }
    }
    if (!hasProvider(ProviderName.Signature, doc)) return { error: `Signature help provider not found for ${doc.uri}` }
    try {
      let help = await languages.getSignatureHelp(doc.textDocument, pos, token, {
        triggerKind: SignatureHelpTriggerKind.Invoked,
        isRetrigger: false
      })
      return { help }
    } catch (e) {
      return { error: `Signature help request failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
}

export function flattenSymbols(symbols: DocumentSymbol[] | null | undefined, maxResults: number): LimitedList<any> {
  let flattened: any[] = []
  let walk = (list: DocumentSymbol[], depth: number): void => {
    for (let s of list || []) {
      flattened.push({
        name: s.name,
        kind: symbolKindName(s.kind),
        detail: s.detail,
        range: s.range,
        selectionRange: s.selectionRange,
        depth
      })
      walk(s.children as DocumentSymbol[], depth + 1)
    }
  }
  walk(symbols || [], 0)
  return limitResults(flattened, maxResults)
}

export async function getDocumentSymbolResult(
  doc: Document,
  serviceId: string | undefined,
  token: CancellationToken
): Promise<{ symbols: DocumentSymbol[] | null } | { error: string }> {
  disableLanguageTrace(doc)
  return withQueryCache(queryVariant('document_symbols', serviceId), doc, null, async () => {
    if (serviceId) {
      let call = await serviceCall(serviceId, 'textDocument/documentSymbol', { textDocument: { uri: doc.uri } }, token)
      if (call.error) return { error: `Document symbol request failed: ${call.error}` }
      let result = call.result
      let symbols = Array.isArray(result) && result.length > 0
        ? (DocumentSymbol.is(result[0]) ? result : asDocumentSymbolTree(result))
        : null
      return { symbols }
    }
    if (!hasProvider(ProviderName.DocumentSymbol, doc)) return { error: `Document symbol provider not found for ${doc.uri}` }
    try {
      return { symbols: await languages.getDocumentSymbol(doc.textDocument, token) }
    } catch (e) {
      return { error: `Document symbol request failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
}

export const BATCH_METHODS: string[] = [
  'hover',
  'signature_help',
  'definition',
  'declaration',
  'type_definition',
  'implementation',
  'references',
  'document_symbols'
]

export const BATCH_POSITION_METHODS = new Set<string>(BATCH_METHODS.filter(m => m !== 'document_symbols'))

export async function runBatchMethod(
  method: string,
  doc: Document,
  pos: Position | null,
  serviceId: string | undefined,
  maxResults: number,
  includeDeclaration: boolean,
  token: CancellationToken
): Promise<any> {
  switch (method) {
    case 'hover': {
      let res = await getHoverResult(doc, pos!, serviceId, token)
      if ('error' in res) return { error: res.error }
      return { count: res.hovers.length, hovers: res.hovers.map(hoverSummary) }
    }
    case 'signature_help': {
      let res = await getSignatureResult(doc, pos!, serviceId, token)
      if ('error' in res) return { error: res.error }
      return signatureSummary(res.help)
    }
    case 'references':
      return await locationResultBody(doc, pos!, serviceId, referencesQuery(includeDeclaration), maxResults, token)
    case 'definition':
    case 'declaration':
    case 'type_definition':
    case 'implementation':
      return await locationResultBody(doc, pos!, serviceId, LOCATION_QUERIES[method], maxResults, token)
    case 'document_symbols': {
      let res = await getDocumentSymbolResult(doc, serviceId, token)
      if ('error' in res) return { error: res.error }
      let limited = flattenSymbols(res.symbols, maxResults)
      return { count: limited.total, returned: limited.items.length, truncated: limited.truncated, symbols: limited.items }
    }
    default:
      return { error: `Unknown batch method: ${method}` }
  }
}

export function countTextEdits(edit: any): number {
  let count = 0
  if (edit?.changes && typeof edit.changes === 'object') {
    for (let key of Object.keys(edit.changes)) {
      count += Array.isArray(edit.changes[key]) ? edit.changes[key].length : 0
    }
  }
  if (Array.isArray(edit?.documentChanges)) {
    for (let change of edit.documentChanges) {
      if (change?.edits && Array.isArray(change.edits)) count += change.edits.length
    }
  }
  return count
}

export function codeActionSummary(action: CodeAction): any {
  return {
    title: action.title,
    kind: action.kind,
    isPreferred: action.isPreferred === true,
    disabled: action.disabled ? { reason: action.disabled.reason } : undefined,
    hasEdit: action.edit !== undefined,
    command: action.command ? {
      command: action.command.command,
      title: action.command.title
    } : undefined
  }
}

const SYMBOL_KIND_NAMES: { [key: number]: string } = {}
for (let key of Object.keys(SymbolKind)) {
  let value = (SymbolKind as any)[key]
  if (typeof value === 'number') {
    SYMBOL_KIND_NAMES[value] = key
  }
}

export function symbolKindName(kind: any): string | undefined {
  if (typeof kind === 'number') {
    return SYMBOL_KIND_NAMES[kind] ?? String(kind)
  }
  if (typeof kind === 'string') {
    let numeric = Number(kind)
    if (!isNaN(numeric) && SYMBOL_KIND_NAMES[numeric]) {
      return SYMBOL_KIND_NAMES[numeric]
    }
    return kind
  }
  return undefined
}

export async function getCodeActionList(args: any, context: ToolContext): Promise<{ doc?: Document, range?: Range, actions: CodeAction[], error?: string }> {
  let ref = await resolveDocument(args?.uri, true)
  if (ref.error) return { actions: [], error: ref.error }
  let doc = ref.doc!
  doc._forceSync()
  disableLanguageTrace(doc)
  let range = rangeFromArgs(args) ?? fullRange(doc)
  let diagnostics = diagnosticManager.getDiagnosticsInRange(doc.textDocument, range)
  let codeActionContext: CodeActionContext = {
    diagnostics,
    triggerKind: CodeActionTriggerKind.Invoked
  }
  if (typeof args?.kind === 'string') codeActionContext.only = [args.kind]
  let actions: CodeAction[]
  try {
    actions = await languages.getCodeActions(doc.textDocument, range, codeActionContext, context.token)
  } catch (e) {
    return { doc, range, actions: [], error: `Code action request failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { doc, range, actions: actions || [] }
}

export function positionInputSchema(extra?: Record<string, any>): Record<string, any> {
  return {
    type: 'object',
    properties: {
      uri: { type: 'string' },
      position: { $ref: '#/definitions/Position' },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum number of results to return (default 200).' },
      ...extra
    },
    required: ['position']
  }
}

export function locationOutputSchema(locations?: Record<string, any>): Record<string, any> {
  return {
    type: 'object',
    properties: {
      uri: { type: 'string' },
      position: { type: 'object' },
      count: { type: 'integer', description: 'Total number of results found.' },
      returned: { type: 'integer', description: 'Number of results returned, may be less than count when truncated.' },
      truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
      locations: { type: 'array', items: locations ?? { type: 'object' } }
    }
  }
}

export function createLspTools(): McpTool[] {
  return [
    {
      name: 'lsp/hover',
      title: 'Hover',
      description: 'Get hover information (signature, documentation) at a position from the language server.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { $ref: '#/definitions/Position' },
        },
        required: ['position']
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { type: 'object' },
          count: { type: 'integer' },
          hovers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                contents: { type: 'array', items: { type: 'string' } },
                range: { type: 'object' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let r = await resolvePositionedDoc(args)
        if (r.error) return errorResult(r.error)
        let doc = r.doc!
        let pos = r.position!
        let res = await getHoverResult(doc, pos, configuredServiceId(doc), context.token)
        if ('error' in res) return errorResult(res.error)
        let list = res.hovers.map(hoverSummary)
        let text = list.map(h => h.contents.join('\n\n')).filter(Boolean).join('\n\n---\n\n') || 'No hover content'
        let result = { uri: doc.uri, position: pos, count: list.length, hovers: list }
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/signature_help',
      title: 'Signature Help',
      description: 'Get signature help (parameter labels and documentation) at a position.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { $ref: '#/definitions/Position' },
        },
        required: ['position']
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { type: 'object' },
          activeSignature: { type: 'integer' },
          activeParameter: { type: 'integer' },
          signatures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                documentation: { type: 'string' },
                parameters: { type: 'array', items: { type: 'object' } }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let r = await resolvePositionedDoc(args)
        if (r.error) return errorResult(r.error)
        let doc = r.doc!
        let pos = r.position!
        let res = await getSignatureResult(doc, pos, configuredServiceId(doc), context.token)
        if ('error' in res) return errorResult(res.error)
        let result = { uri: doc.uri, position: pos, ...signatureSummary(res.help) }
        let text = result.signatures.length === 0
          ? 'No signature help'
          : result.signatures.map((s, i) => {
            let mark = i === result.activeSignature ? '*' : ' '
            return `${mark} ${s.label}`
          }).join('\n')
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/document_symbols',
      title: 'Document Symbols',
      description: 'List symbols in a document (flattened with kind and ranges).',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum number of symbols to return (default 500).' },
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          count: { type: 'integer', description: 'Total number of symbols found.' },
          returned: { type: 'integer', description: 'Number of symbols returned, may be less than count when truncated.' },
          truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
          symbols: { type: 'array', items: { type: 'object' } }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let ref = await resolveDocument(args?.uri, true)
        if (ref.error) return errorResult(ref.error)
        let doc = ref.doc!
        doc._forceSync()
        let res = await getDocumentSymbolResult(doc, configuredServiceId(doc), context.token)
        if ('error' in res) return errorResult(res.error)
        let limited = flattenSymbols(res.symbols, maxResultsFromArgs(args, 500))
        let result = { uri: doc.uri, count: limited.total, returned: limited.items.length, truncated: limited.truncated, symbols: limited.items }
        let text = limited.items.length === 0
          ? 'No document symbols'
          : limited.items.map(s => `${'  '.repeat(s.depth)}${s.name} (${s.kind})`).join('\n')
          + (limited.truncated ? `\n\nTruncated: showing ${limited.items.length} of ${limited.total} symbols (raise maxResults to return more)` : '')
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/workspace_symbols',
      title: 'Workspace Symbols',
      description: 'Search workspace symbols by query string.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum number of symbols to return (default 500).' },
        },
        required: ['query']
      },
      outputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'integer', description: 'Total number of symbols found.' },
          returned: { type: 'integer', description: 'Number of symbols returned, may be less than count when truncated.' },
          truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
          symbols: { type: 'array', items: { type: 'object' } }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let query = args?.query
        if (typeof query !== 'string' || query.length === 0) return errorResult('query is required')
        let symbols: WorkspaceSymbol[]
        try {
          symbols = await languages.getWorkspaceSymbols(query, context.token)
        } catch (e) {
          return errorResult(`Workspace symbol request failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        let list = (symbols || []).map(s => ({
          name: s.name,
          kind: symbolKindName(s.kind),
          containerName: s.containerName,
          location: s.location
        }))
        let limited = limitResults(list, maxResultsFromArgs(args, 500))
        let result = { query, count: limited.total, returned: limited.items.length, truncated: limited.truncated, symbols: limited.items }
        let text = limited.items.length === 0
          ? 'No workspace symbols'
          : limited.items.map(s => `${s.name} (${s.kind})${s.containerName ? ' in ' + s.containerName : ''}`).join('\n')
          + (limited.truncated ? `\n\nTruncated: showing ${limited.items.length} of ${limited.total} symbols (raise maxResults to return more)` : '')
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/definition',
      title: 'Definition',
      description: 'Find definitions at a position.',
      inputSchema: positionInputSchema(),
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { type: 'object' },
          count: { type: 'integer', description: 'Total number of results found.' },
          returned: { type: 'integer', description: 'Number of results returned, may be less than count when truncated.' },
          truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
          locations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                range: { type: 'object' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: (args: any, context: ToolContext) => locationTool(args, context, LOCATION_QUERIES.definition)
    },
    {
      name: 'lsp/declaration',
      title: 'Declaration',
      description: 'Find declarations at a position.',
      inputSchema: positionInputSchema(),
      outputSchema: locationOutputSchema(),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: (args: any, context: ToolContext) => locationTool(args, context, LOCATION_QUERIES.declaration)
    },
    {
      name: 'lsp/type_definition',
      title: 'Type Definition',
      description: 'Find type definitions at a position.',
      inputSchema: positionInputSchema(),
      outputSchema: locationOutputSchema(),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: (args: any, context: ToolContext) => locationTool(args, context, LOCATION_QUERIES.type_definition)
    },
    {
      name: 'lsp/implementation',
      title: 'Implementation',
      description: 'Find implementations at a position.',
      inputSchema: positionInputSchema(),
      outputSchema: locationOutputSchema(),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: (args: any, context: ToolContext) => locationTool(args, context, LOCATION_QUERIES.implementation)
    },
    {
      name: 'lsp/references',
      title: 'References',
      description: 'Find references at a position, optionally including the declaration.',
      inputSchema: positionInputSchema({
        includeDeclaration: { type: 'boolean', default: true }
      }),
      outputSchema: locationOutputSchema(),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: (args: any, context: ToolContext) => locationTool(args, context, referencesQuery(args?.includeDeclaration !== false))
    },
    {
      name: 'lsp/batch',
      title: 'Batch LSP Queries',
      description: 'Run several LSP queries on one document in a single call, executed in parallel. methods: hover, signature_help, definition, declaration, type_definition, implementation, references, document_symbols.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { $ref: '#/definitions/Position' },
          methods: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'LSP queries to run in parallel.'
          },
          includeDeclaration: { type: 'boolean', default: true, description: 'Whether references includes the declaration.' },
          maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum results per list method (default 200).' }
        },
        required: ['methods']
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { type: 'object' },
          results: { type: 'object' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let methods = args?.methods
        if (!Array.isArray(methods) || methods.length === 0) return errorResult('methods is required')
        for (let m of methods) {
          if (typeof m !== 'string' || !BATCH_METHODS.includes(m)) return errorResult(`Unknown batch method: ${String(m)}`)
        }
        let ref = await resolveDocument(args?.uri, true)
        if (ref.error) return errorResult(ref.error)
        let doc = ref.doc!
        let pos = positionFromArgs(args)
        let needsPosition = methods.some((m: string) => BATCH_POSITION_METHODS.has(m))
        if (needsPosition && !pos) return errorResult('position {line, character} is required')
        doc._forceSync()
        let serviceId = configuredServiceId(doc)
        let maxResults = maxResultsFromArgs(args, 200)
        let includeDeclaration = args?.includeDeclaration !== false
        let results: Record<string, any> = {}
        await Promise.all(methods.map(async (m: string) => {
          try {
            results[m] = await runBatchMethod(m, doc, pos, serviceId, maxResults, includeDeclaration, context.token)
          } catch (e) {
            results[m] = { error: `Batch method ${m} failed: ${e instanceof Error ? e.message : String(e)}` }
          }
        }))
        let text = methods.map((m: string) => {
          let r = results[m]
          if (r?.error) return `${m}: error - ${r.error}`
          if (r?.locations) return `${m}: ${r.returned} of ${r.count} location(s)${r.truncated ? ' (truncated)' : ''}`
          if (r?.symbols) return `${m}: ${r.returned} of ${r.count} symbol(s)${r.truncated ? ' (truncated)' : ''}`
          if (r?.hovers) return `${m}: ${r.count} hover item(s)`
          if (r?.signatures) return `${m}: ${r.signatures.length} signature(s)`
          return `${m}: done`
        }).join('\n')
        let result = { uri: doc.uri, position: pos ?? null, results }
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/diagnostics',
      title: 'Document Diagnostics',
      description: 'Get diagnostics for a document (optionally filtered to a range).',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          range: { $ref: '#/definitions/Range' },
          maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum number of diagnostics to return (default 100).' },
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          count: { type: 'integer', description: 'Total number of diagnostics found.' },
          returned: { type: 'integer', description: 'Number of diagnostics returned, may be less than count when truncated.' },
          truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
          diagnostics: { type: 'array', items: { type: 'object' } }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any) => {
        let ref = await resolveDocument(args?.uri, false)
        if (ref.error) return errorResult(ref.error)
        if (!ref.doc) return errorResult(`Document is not open: ${ref.uri}`)
        let doc = ref.doc
        let diagnostics: Diagnostic[] = []
        try {
          diagnostics = diagnosticManager.getDiagnosticsInRange(doc.textDocument, rangeFromArgs(args))
        } catch (e) {
          return errorResult(`Failed to read diagnostics: ${e instanceof Error ? e.message : String(e)}`)
        }
        let limited = limitResults(diagnostics, maxResultsFromArgs(args, 100))
        let result = { uri: ref.uri, count: limited.total, returned: limited.items.length, truncated: limited.truncated, diagnostics: limited.items }
        let text = limited.items.length === 0
          ? 'No diagnostics'
          : limited.items.map(d => {
            let severity = ['Error', 'Warning', 'Information', 'Hint'][(d.severity ?? 1) - 1] ?? 'Unknown'
            let pos = d.range.start
            let codeText = ''
            let code = d.code
            if (code != null) {
              codeText = typeof code === 'object'
                ? String((code as { value: string | number }).value)
                : String(code as string | number)
            }
            return `${severity} ${pos.line + 1}:${pos.character + 1} ${d.message}${codeText ? ` [${codeText}]` : ''}`
          }).join('\n') + (limited.truncated ? `\n\nTruncated: showing ${limited.items.length} of ${limited.total} diagnostics (raise maxResults to return more)` : '')
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/code_actions',
      title: 'Code Actions',
      description: 'List available code actions for a document range (diagnostics-based).',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          range: { $ref: '#/definitions/Range' },
          kind: { type: 'string', description: 'Optional CodeActionKind filter, e.g. "source.organizeImports".' },
          maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS_HARD_LIMIT, description: 'Maximum number of actions to return (default 100).' },
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          count: { type: 'integer', description: 'Total number of actions found.' },
          returned: { type: 'integer', description: 'Number of actions returned, may be less than count when truncated.' },
          truncated: { type: 'boolean', description: 'True when results were truncated to the maxResults limit.' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                kind: { type: 'string' },
                isPreferred: { type: 'boolean' },
                disabled: { type: 'object' },
                hasEdit: { type: 'boolean' },
                command: { type: 'object' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let list = await getCodeActionList(args, context)
        if (list.error) return errorResult(list.error)
        let limited = limitResults(list.actions, maxResultsFromArgs(args, 100))
        let actions = limited.items.map(codeActionSummary)
        let result = { uri: list.doc.uri, count: limited.total, returned: actions.length, truncated: limited.truncated, actions }
        let text = actions.length === 0
          ? 'No code actions'
          : actions.map((a, i) => `${i}. ${a.title}${a.disabled ? ' (disabled: ' + a.disabled.reason + ')' : ''}`).join('\n')
          + (limited.truncated ? `\n\nTruncated: showing ${actions.length} of ${limited.total} actions (raise maxResults to return more)` : '')
        return textResult(text, result)
      }
    },
    {
      name: 'lsp/apply_code_action',
      title: 'Apply Code Action',
      description: 'Apply a code action by title or index from lsp/code_actions. Applies the edit or executes the command.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          range: { $ref: '#/definitions/Range' },
          kind: { type: 'string' },
          title: { type: 'string', description: 'Exact action title to apply.' },
          index: { type: 'integer', description: 'Index in the lsp/code_actions list.' },
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          title: { type: 'string' },
          applied: { type: 'boolean' },
          actions: { type: 'array', items: { type: 'string' } }
        }
      },
      annotations: { destructiveHint: true },
      handler: async (args: any, context: ToolContext) => {
        let list = await getCodeActionList(args, context)
        if (list.error) return errorResult(list.error)
        let selected: CodeAction | undefined
        if (typeof args?.title === 'string') {
          selected = list.actions.find(a => a.title === args.title)
          if (!selected) return errorResult(`Code action not found: ${args.title}`)
        } else if (typeof args?.index === 'number') {
          selected = list.actions[args.index]
          if (!selected) return errorResult(`Code action at index ${args.index} not found`)
        } else {
          return errorResult('title or index is required')
        }
        if (selected.disabled) {
          return errorResult(`Code action "${selected.title}" is disabled: ${selected.disabled.reason}`)
        }
        let resolved: CodeAction | undefined
        try {
          resolved = await languages.resolveCodeAction(selected, context.token)
        } catch (e) {
          return errorResult(`Failed to resolve code action: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (!resolved) return errorResult('Failed to resolve code action')
        let applied: string[] = []
        if (resolved.edit) {
          try {
            await workspace.applyEdit(resolved.edit)
            applied.push('edit')
          } catch (e) {
            return errorResult(`Failed to apply code action edit: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        if (resolved.command) {
          try {
            await commandManager.execute(resolved.command)
            applied.push('command')
          } catch (e) {
            return errorResult(`Failed to execute code action command: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        let result = { uri: list.doc.uri, title: selected.title, applied: true, actions: applied }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'lsp/rename',
      title: 'Rename Symbol',
      description: 'Rename the symbol at a position across the workspace using the language server. preview=true returns the WorkspaceEdit without applying.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          position: { $ref: '#/definitions/Position' },
          newName: { type: 'string' },
          preview: { type: 'boolean', default: false },
        },
        required: ['position', 'newName']
      },
      outputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          preview: { type: 'boolean' },
          applied: { type: 'boolean' },
          newName: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          editCount: { type: 'integer' },
          edit: { type: 'object' }
        }
      },
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args: any, context: ToolContext) => {
        let r = await resolvePositionedDoc(args)
        if (r.error) return errorResult(r.error)
        let doc = r.doc!
        let pos = r.position!
        let newName = args?.newName
        if (typeof newName !== 'string' || newName.length === 0) return errorResult('newName is required')
        let prepared
        let serviceId = configuredServiceId(doc)
        if (serviceId) {
          let call = await serviceCall(serviceId, 'textDocument/prepareRename', { textDocument: { uri: doc.uri }, position: pos }, context.token)
          if (call.error) return errorResult(`Rename prepare failed: ${call.error}`)
          prepared = call.result
          if (prepared == null) return errorResult('Invalid position for rename')
        } else {
          if (!hasProvider(ProviderName.Rename, doc)) return errorResult(`Rename provider not found for ${doc.uri}`)
          try {
            prepared = await languages.prepareRename(doc.textDocument, pos, context.token)
          } catch (e) {
            return errorResult(`Rename prepare failed: ${e instanceof Error ? e.message : String(e)}`)
          }
          if (prepared === false) return errorResult('Invalid position for rename')
        }
        let edit
        if (serviceId) {
          let call = await serviceCall(serviceId, 'textDocument/rename', {
            textDocument: { uri: doc.uri },
            position: pos,
            newName
          }, context.token)
          if (call.error) return errorResult(`Rename request failed: ${call.error}`)
          edit = call.result
        } else {
          try {
            edit = await languages.provideRenameEdits(doc.textDocument, pos, newName, context.token)
          } catch (e) {
            return errorResult(`Rename request failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        if (!edit) return errorResult('Rename provider returned no edits')
        let files = collectEditUris(edit)
        let editCount = countTextEdits(edit)
        if (args?.preview === true) {
          let result = { uri: doc.uri, preview: true, applied: false, newName, files, editCount, edit }
          return textResult(JSON.stringify(result, null, 2), result)
        }
        let applied: boolean
        try {
          applied = await workspace.applyEdit(edit)
        } catch (e) {
          return errorResult(`Failed to apply rename: ${e instanceof Error ? e.message : String(e)}`)
        }
        let result = { uri: doc.uri, preview: false, applied, newName, files, editCount }
        return textResult(JSON.stringify(result, null, 2), result)
      }
    },
    {
      name: 'lsp/execute_command',
      title: 'Execute Language Server Command',
      description: 'Execute a workspace/executeCommand on a language server by service id.',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'string' },
          command: { type: 'string' },
          arguments: { type: 'array' }
        },
        required: ['serviceId', 'command']
      },
      outputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          result: {}
        }
      },
      annotations: { openWorldHint: true },
      handler: async (args: any, context: ToolContext) => {
        let serviceId = args?.serviceId
        let command = args?.command
        if (typeof serviceId !== 'string' || typeof command !== 'string') return errorResult('serviceId and command are required')
        let service = services.getService(serviceId)
        if (!service || !service.client) return errorResult(`Language server "${serviceId}" not found or not running`)
        let result: any
        try {
          result = await services.sendRequest(serviceId, 'workspace/executeCommand', {
            command,
            arguments: Array.isArray(args?.arguments) ? args.arguments : []
          }, context.token)
        } catch (e) {
          return errorResult(`Execute command failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        return textResult(JSON.stringify(result ?? null, null, 2), { command, result })
      }
    },
    {
      name: 'lsp/request',
      title: 'Language Server Request',
      description: 'Send an arbitrary LSP request to a language server by service id. Advanced: method and params follow the LSP specification.',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'string' },
          method: { type: 'string' },
          params: { type: 'object' }
        },
        required: ['serviceId', 'method']
      },
      outputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          result: {}
        }
      },
      annotations: { openWorldHint: true },
      handler: async (args: any, context: ToolContext) => {
        let serviceId = args?.serviceId
        let method = args?.method
        if (typeof serviceId !== 'string' || typeof method !== 'string') return errorResult('serviceId and method are required')
        let service = services.getService(serviceId)
        if (!service || !service.client) return errorResult(`Language server "${serviceId}" not found or not running`)
        let result: any
        try {
          result = await services.sendRequest(serviceId, method, args?.params, context.token)
        } catch (e) {
          return errorResult(`Request ${method} failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        return textResult(JSON.stringify(result ?? null, null, 2), { method, result })
      }
    },
    {
      name: 'lsp/capabilities',
      title: 'Language Server Capabilities',
      description: 'List running language servers and their capabilities (from initialize result).',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', description: 'Optional; list one server instead of all.' }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          services: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                state: { type: 'string' },
                languageIds: { type: 'array', items: { type: 'string' } },
                capabilities: { type: 'object' },
                serverInfo: { type: 'object' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async () => {
        let all = services.getServiceStats()
        let servicesList = all.map(stat => {
          let service = services.getService(stat.id)
          let init = service?.client?.initializeResult
          return {
            id: stat.id,
            state: stat.state,
            languageIds: stat.languageIds,
            capabilities: init?.capabilities ?? null,
            serverInfo: init?.serverInfo ?? null
          }
        })
        let result = { count: servicesList.length, services: servicesList }
        let text = servicesList.length === 0
          ? 'No language servers running'
          : servicesList.map(s => `${s.id} [${s.state}] ${s.languageIds.join(',')}`).join('\n')
        return textResult(text, result)
      }
    }
  ]
}
