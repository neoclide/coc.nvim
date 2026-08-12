'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import { Position, Range } from 'vscode-languageserver-types'
import commands from '../../commands'
import diagnosticManager from '../../diagnostic/manager'
import events from '../../events'
import languages from '../../languages'
import { createLspTools, getServiceLimiter, lspQueryCache, MAX_STUCK_REQUESTS, withServiceLimit } from '../../mcp/tools/lsp'
import services, { ServiceStat } from '../../services'
import helper from '../helper'
import { CancellationToken, CancellationTokenSource, Trace } from '../../util/protocol'
import workspace from '../../workspace'

const serverModule = path.join(__dirname, '../client/server/testServer.js')
let disposables: { dispose(): void }[] = []
let tmpdir: string
let file: string
let uri: string
const token = CancellationToken.None

async function waitFor(fn: () => boolean, timeout = 8000): Promise<void> {
  let start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) {
      let docs = workspace.documents.map(d => `${d.languageId}:${d.uri}:attached=${d.attached}`)
      let selector = services.getService('test')?.selector
      let match = selector ? workspace.match(selector, workspace.getDocument(uri)!.textDocument) : 'no-selector'
      throw new Error(`waitFor timeout, stats: ${JSON.stringify(services.getServiceStats())}, docs: ${JSON.stringify(docs)}, match: ${match}, ready: ${events.ready}`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

beforeAll(async () => {
  await helper.setup()
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-lsp-'))
  let vimdir = path.join(tmpdir, '.vim')
  fs.mkdirSync(vimdir, { recursive: true })
  fs.writeFileSync(path.join(vimdir, 'coc-settings.json'), JSON.stringify({
    languageserver: {
      test: {
        module: serverModule,
        filetypes: ['vim']
      }
    }
  }, null, 2))
  workspace.configurations.locateFolderConfigution(URI.file(path.join(tmpdir, 'sample.vim')).toString())
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.vim')
  fs.writeFileSync(file, 'let a = 1\nlet b = 2\n')
  uri = URI.file(file).toString()
  await helper.nvim.command(`edit ${file}`)
  await helper.nvim.command('setfiletype vim')
  await helper.waitValue(() => !!workspace.getDocument(uri), true)
  await helper.waitValue(() => workspace.getDocument(uri)!.languageId, 'vim')
  await waitFor(() => services.getService('test')?.state === ServiceStat.Running)
  workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
  disposables.push(commands.registerCommand('test_command', () => ({ success: true })))
})

afterAll(async () => {
  workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
  for (let d of disposables) d.dispose()
  await helper.shutdown()
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool(name: string) {
  return createLspTools().find(t => t.name === name)!
}

describe('mcp lsp tools', () => {
  it('lsp/hover returns hover contents', async () => {
    let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.ok((result.structuredContent.hovers[0].contents).includes('foo'))
  })

  it('lsp/definition returns locations', async () => {
    let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.count, 1)
    let loc = result.structuredContent.locations[0]
    assert.strictEqual(loc.uri, uri)
    assert.strictEqual(loc.range.start.line, 0)
  })

  it('lsp/references returns locations', async () => {
    let result = await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.count, 2)
  })

  it('lsp/hover uses the configured service for the language', async () => {
    let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.ok((result.structuredContent.hovers[0].contents).includes('foo'))
  })

  it('lsp/signature_help uses the configured service for the language', async () => {
    let result = await tool('lsp/signature_help').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.signatures[0].label, 'label')
  })

  it('lsp/definition uses the configured service for the language', async () => {
    let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.count, 1)
    let loc = result.structuredContent.locations[0]
    assert.strictEqual(loc.uri, uri)
    assert.strictEqual(loc.range.start.line, 0)
  })

  it('lsp/references uses the configured service for the language', async () => {
    let result = await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.count, 2)
  })

  it('lsp/definition with a missing configured service returns error', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'missing' } })
    try {
      let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      assert.ok(result.isError)
      assert.ok((result.content[0].text).includes('missing'))
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
    }
  })

  it('lsp/signature_help returns signature labels', async () => {
    let result = await tool('lsp/signature_help').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.signatures[0].label, 'label')
    assert.strictEqual(result.structuredContent.activeSignature, 1)
  })

  it('lsp/document_symbols returns flattened symbols', async () => {
    let result = await tool('lsp/document_symbols').handler({ uri: file }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.symbols[0].name, 'name')
    assert.strictEqual(result.structuredContent.symbols[0].kind, 'Method')
  })

  it('lsp/document_symbols uses the configured service for the language', async () => {
    let result = await tool('lsp/document_symbols').handler({ uri: file }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.symbols[0].name, 'name')
    assert.strictEqual(result.structuredContent.symbols[0].kind, 'Method')
  })

  it('lsp/workspace_symbols searches by query', async () => {
    let result = await tool('lsp/workspace_symbols').handler({ query: 'name' }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.symbols[0].name, 'name')
  })

  it('lsp/diagnostics returns the current list (empty here)', async () => {
    let result = await tool('lsp/diagnostics').handler({ uri: file }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.count, 1)
    assert.strictEqual(result.structuredContent.diagnostics[0].message, 'diagnostic')
  })

  it('lsp/diagnostics requires an open document', async () => {
    let unopened = path.join(tmpdir, 'unopened-diagnostics.txt')
    fs.writeFileSync(unopened, 'plain\n')
    let result = await tool('lsp/diagnostics').handler({ uri: unopened }, { token })
    assert.ok((result.content[0].text).includes('not open'))
  })

  it('lsp/code_actions lists actions without applying', async () => {
    let result = await tool('lsp/code_actions').handler({ uri: file }, { token })
    assert.ok(!(result.isError))
    let titles = result.structuredContent.actions.map((a: any) => a.title)
    assert.ok((titles).includes('title'))
    assert.ok((titles).includes('other title'))
  })

  it('lsp/apply_code_action applies the selected action', async () => {
    let result = await tool('lsp/apply_code_action').handler({ uri: file, title: 'title' }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.applied, true)
    assert.ok((result.structuredContent.actions).includes('command'))
  })

  it('lsp/rename previews and applies', async () => {
    let preview = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed', preview: true }, { token })
    assert.ok(!(preview.isError))
    assert.strictEqual(preview.structuredContent.preview, true)
    assert.ok(preview.structuredContent.edit)
    let applied = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed' }, { token })
    assert.ok(!(applied.isError))
    assert.strictEqual(applied.structuredContent.applied, true)
  })

  it('lsp/rename uses the configured service for the language', async () => {
    let preview = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed', preview: true }, { token })
    assert.ok(!(preview.isError))
    assert.strictEqual(preview.structuredContent.preview, true)
    assert.ok(preview.structuredContent.edit)
  })

  it('falls back to provider aggregation when no service is configured', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
    try {
      let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.count, 1)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
    }
  })

  it('lsp/batch runs multiple methods in parallel', async () => {
    let result = await tool('lsp/batch').handler({
      uri: file,
      position: { line: 1, character: 1 },
      methods: ['hover', 'definition', 'references', 'document_symbols']
    }, { token })
    assert.ok(!(result.isError))
    let results = result.structuredContent.results
    assert.ok((results.hover.hovers[0].contents).includes('foo'))
    assert.strictEqual(results.definition.count, 1)
    assert.strictEqual(results.references.count, 2)
    assert.strictEqual(results.document_symbols.symbols[0].name, 'name')
  })

  it('lsp/batch dispatches every supported query method', async () => {
    let result = await tool('lsp/batch').handler({
      uri: file,
      position: { line: 1, character: 1 },
      methods: ['signature_help', 'declaration', 'type_definition', 'implementation']
    }, { token })
    assert.ok(!(result.isError))
    assert.deepStrictEqual(Object.keys(result.structuredContent.results), ['signature_help', 'declaration', 'type_definition', 'implementation'])
  })

  it('lsp/batch rejects unknown methods', async () => {
    let result = await tool('lsp/batch').handler({
      uri: file,
      position: { line: 1, character: 1 },
      methods: ['hover', 'bogus']
    }, { token })
    assert.ok(result.isError)
    assert.ok((result.content[0].text).includes('bogus'))
  })

  it('validates required arguments across LSP tools', async () => {
    for (let name of ['lsp/hover', 'lsp/signature_help', 'lsp/definition', 'lsp/declaration',
      'lsp/type_definition', 'lsp/implementation', 'lsp/references', 'lsp/rename']) {
      let result = await tool(name).handler({ uri: file }, { token })
      assert.strictEqual(result.isError, true)
      assert.ok((result.content[0].text).includes('position'))
    }
    assert.strictEqual((await tool('lsp/workspace_symbols').handler({}, { token })).isError, true)
    assert.strictEqual((await tool('lsp/batch').handler({}, { token })).isError, true)
    assert.ok(((await tool('lsp/batch').handler({ uri: file, methods: ['hover'] }, { token })).content[0].text).includes('position'))
    assert.strictEqual((await tool('lsp/execute_command').handler({}, { token })).isError, true)
    assert.strictEqual((await tool('lsp/request').handler({}, { token })).isError, true)
    assert.ok(((await tool('lsp/rename').handler({ uri: file, position: { line: 0, character: 0 }, newName: '' }, { token })).content[0].text).includes('newName'))
  })

  it('propagates document resolution errors across LSP tools', async () => {
    let args = { uri: '/etc/passwd', position: { line: 0, character: 0 }, methods: ['hover'] }
    for (let name of ['lsp/hover', 'lsp/signature_help', 'lsp/document_symbols', 'lsp/definition',
      'lsp/batch', 'lsp/diagnostics', 'lsp/code_actions', 'lsp/apply_code_action', 'lsp/rename']) {
      let result = await tool(name).handler(args, { token })
      assert.strictEqual(result.isError, true)
    }
  })

  it('reports unavailable configured services for direct query tools', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'missing' } })
    try {
      for (let name of ['lsp/hover', 'lsp/signature_help', 'lsp/document_symbols']) {
        let result = await tool(name).handler({ uri: file, position: { line: 1, character: 1 } }, { token })
        assert.strictEqual(result.isError, true)
        assert.ok((result.content[0].text).includes('missing'))
      }
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
    }
  })

  it('validates code action selection and resolution', async (t) => {
    let apply = tool('lsp/apply_code_action')
    assert.ok(((await apply.handler({ uri: file }, { token })).content[0].text).includes('title or index'))
    assert.ok(((await apply.handler({ uri: file, title: 'missing' }, { token })).content[0].text).includes('not found'))
    assert.ok(((await apply.handler({ uri: file, index: 99 }, { token })).content[0].text).includes('not found'))
    let resolve = t.mock.method(languages, 'resolveCodeAction', () => Promise.resolve(undefined), { times: 1 })
    try {
      assert.ok(((await apply.handler({ uri: file, title: 'title' }, { token })).content[0].text).includes('Failed to resolve'))
    } finally {
      resolve.mock.restore()
    }
    resolve = t.mock.method(languages, 'resolveCodeAction', () => Promise.reject(new Error('resolve failed')), { times: 1 })
    try {
      assert.ok(((await apply.handler({ uri: file, title: 'title' }, { token })).content[0].text).includes('resolve failed'))
    } finally {
      resolve.mock.restore()
    }
  })

  it('handles edit-only code actions and code action filters', async (t) => {
    let actions = t.mock.method(languages, 'getCodeActions', () => Promise.resolve(undefined as any), { times: 1 })
    try {
      let empty = await tool('lsp/code_actions').handler({ uri: file, kind: 'quickfix' }, { token })
      assert.deepStrictEqual(empty.structuredContent.actions, [])
    } finally {
      actions.mock.restore()
    }
    let resolve = t.mock.method(languages, 'resolveCodeAction', () => Promise.resolve({ title: 'title', edit: { changes: {} } }), { times: 1 })
    let apply = t.mock.method(workspace, 'applyEdit', () => Promise.resolve(true), { times: 1 })
    try {
      let result = await tool('lsp/apply_code_action').handler({ uri: file, title: 'title' }, { token })
      assert.deepStrictEqual(result.structuredContent.actions, ['edit'])
    } finally {
      resolve.mock.restore()
      apply.mock.restore()
    }
  })

  it('uses provider aggregation for rename when no service is mapped', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
    try {
      let result = await tool('lsp/rename').handler({
        uri: file, position: { line: 1, character: 1 }, newName: 'provider-name', preview: true
      }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.preview, true)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
    }
  })

  it('reports downstream LSP and edit failures', async (t) => {
    let symbols = t.mock.method(languages, 'getWorkspaceSymbols', () => Promise.reject(new Error('symbols failed')), { times: 1 })
    try {
      assert.ok(((await tool('lsp/workspace_symbols').handler({ query: 'x' }, { token })).content[0].text).includes('symbols failed'))
    } finally {
      symbols.mock.restore()
    }
    symbols = t.mock.method(languages, 'getWorkspaceSymbols', () => Promise.reject('symbols string'), { times: 1 })
    try {
      assert.ok(((await tool('lsp/workspace_symbols').handler({ query: 'x' }, { token })).content[0].text).includes('symbols string'))
    } finally {
      symbols.mock.restore()
    }
    let diagnostics = t.mock.method(diagnosticManager, 'getDiagnosticsInRange', () => { throw new Error('diagnostics failed') }, { times: 1 })
    try {
      assert.ok(((await tool('lsp/diagnostics').handler({ uri: file }, { token })).content[0].text).includes('diagnostics failed'))
    } finally {
      diagnostics.mock.restore()
    }
    let apply = t.mock.method(workspace, 'applyEdit', () => Promise.reject(new Error('rename apply failed')), { times: 1 })
    try {
      let result = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed' }, { token })
      assert.ok((result.content[0].text).includes('rename apply failed'))
    } finally {
      apply.mock.restore()
    }
    let send = t.mock.method(services, 'sendRequest', () => Promise.reject(new Error('request failed')))
    try {
      assert.ok(((await tool('lsp/execute_command').handler({ serviceId: 'test', command: 'x' }, { token })).content[0].text).includes('request failed'))
      assert.ok(((await tool('lsp/request').handler({ serviceId: 'test', method: 'custom/test' }, { token })).content[0].text).includes('request failed'))
    } finally {
      send.mock.restore()
    }
  })

  it('lsp/batch allows document_symbols without position', async () => {
    let result = await tool('lsp/batch').handler({ uri: file, methods: ['document_symbols'] }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.results.document_symbols.symbols[0].name, 'name')
  })

  it('lsp tools disable language client trace for agent calls', async () => {
    let client = services.getService('test')!.client as any
    client.trace = Trace.Messages
    let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(client._trace, Trace.Off)
  })

  it('withServiceLimit limits concurrent requests per service', async () => {
    let active = 0
    let maxActive = 0
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let tasks = [1, 2, 3, 4].map(() => withServiceLimit('test-limit', 2, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await gate
      active--
    }))
    release()
    await Promise.all(tasks)
    assert.strictEqual(maxActive, 2)
  })

  it('withServiceLimit runs without limit when limit is 0', async () => {
    let active = 0
    let maxActive = 0
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let tasks = [1, 2, 3, 4].map(() => withServiceLimit('test-unlimited', 0, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await gate
      active--
    }))
    release()
    await Promise.all(tasks)
    assert.strictEqual(maxActive, 4)
  })

  it('lsp/execute_command runs workspace/executeCommand on the server', async () => {
    let result = await tool('lsp/execute_command').handler({ serviceId: 'test', command: 'test_command' }, { token })
    assert.ok(!(result.isError))
    assert.deepStrictEqual(result.structuredContent.result, { success: true })
  })

  it('lsp/request passes through arbitrary LSP methods', async () => {
    let result = await tool('lsp/request').handler({ serviceId: 'test', method: 'workspace/symbol', params: { query: 'x' } }, { token })
    assert.ok(!(result.isError))
    assert.strictEqual(result.structuredContent.result[0].name, 'name')
  })

  it('lsp/request and lsp/execute_command return friendly errors for unknown services', async () => {
    let requestResult = await tool('lsp/request').handler({ serviceId: 'missing', method: 'workspace/symbol' }, { token })
    assert.strictEqual(requestResult.isError, true)
    assert.ok((requestResult.content[0].text).includes('not found'))
    let commandResult = await tool('lsp/execute_command').handler({ serviceId: 'missing', command: 'x' }, { token })
    assert.strictEqual(commandResult.isError, true)
    assert.ok((commandResult.content[0].text).includes('not found'))
  })

  it('lsp/capabilities lists servers with initialize capabilities', async () => {
    let result = await tool('lsp/capabilities').handler({}, { token })
    assert.ok(!(result.isError))
    let server = result.structuredContent.services.find((s: any) => s.id === 'languageserver.test')
    assert.ok(server)
    assert.strictEqual(server.state, 'running')
    assert.strictEqual(server.capabilities.definitionProvider, true)
  })

  it('returns a friendly error when no provider exists', async () => {
    let other = path.join(tmpdir, 'other.txt')
    fs.writeFileSync(other, 'plain\n')
    await helper.nvim.command(`edit ${other}`)
    await helper.waitValue(() => !!workspace.getDocument(URI.file(other).toString()), true)
    let result = await tool('lsp/hover').handler({ uri: other, position: { line: 0, character: 0 } }, { token })
    assert.strictEqual(result.isError, true)
    assert.ok((result.content[0].text).includes('provider not found'))
  })

  it('caches idempotent queries and invalidates on document change', async () => {
    lspQueryCache.clear()
    let first = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(first.isError))
    assert.strictEqual(lspQueryCache.size, 1)
    // identical query is served from the cache, no new entry
    let second = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(second.isError))
    assert.ok((second.structuredContent.hovers[0].contents).includes('foo'))
    assert.strictEqual(lspQueryCache.size, 1)
    // lsp/batch reuses the same cache entry for the same query
    await tool('lsp/batch').handler({ uri: file, position: { line: 1, character: 1 }, methods: ['hover'] }, { token })
    assert.strictEqual(lspQueryCache.size, 1)
    // a different position is a distinct entry
    await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 2 } }, { token })
    assert.strictEqual(lspQueryCache.size, 2)
    // references with and without declaration are distinct entries
    await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 }, includeDeclaration: true }, { token })
    await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 }, includeDeclaration: false }, { token })
    assert.strictEqual(lspQueryCache.size, 4)
    // editing the buffer clears every cached entry for the document
    await helper.nvim.command(`edit ${file}`)
    await helper.nvim.call('setline', [1, 'let a = 2'])
    await helper.waitValue(() => lspQueryCache.size, 0)
    // the next query repopulates the cache with the new document version
    let after = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    assert.ok(!(after.isError))
    assert.ok((after.structuredContent.hovers[0].contents).includes('foo'))
    assert.strictEqual(lspQueryCache.size, 1)
  })

  it('does not cache error results', async () => {
    lspQueryCache.clear()
    let otherUri = URI.file(path.join(tmpdir, 'other.txt')).toString()
    let first = await tool('lsp/hover').handler({ uri: otherUri, position: { line: 0, character: 0 } }, { token })
    assert.strictEqual(first.isError, true)
    assert.strictEqual(lspQueryCache.size, 0)
    let second = await tool('lsp/hover').handler({ uri: otherUri, position: { line: 0, character: 0 } }, { token })
    assert.strictEqual(second.isError, true)
    assert.strictEqual(lspQueryCache.size, 0)
  })

  it('fails fast when a language server has stuck requests', async () => {
    let limit = workspace.getConfiguration('mcp').get<number>('maxConcurrentRequests', 4)
    if (limit <= 0) return
    lspQueryCache.clear()
    let limiter = getServiceLimiter('test', limit)
    let releases: (() => void)[] = []
    let tasks: Promise<unknown>[] = []
    try {
      for (let i = 0; i < limit; i++) {
        let token = new CancellationTokenSource()
        let release!: () => void
        let gate = new Promise<void>(resolve => { release = resolve })
        let start!: () => void
        let started = new Promise<void>(resolve => { start = resolve })
        releases.push(release)
        tasks.push(limiter.run(async () => {
          start()
          await gate
        }, token.token))
        await started
        token.cancel()
      }
      assert.strictEqual(limiter.stuckCount, limit)
      let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      assert.strictEqual(result.isError, true)
      assert.ok((result.content[0].text).includes('stuck requests'))
    } finally {
      for (let release of releases) release()
      await Promise.allSettled(tasks)
      assert.strictEqual(limiter.stuckCount, 0)
    }
  })

  it('fails fast with unlimited concurrency once stuck requests accumulate', async () => {
    let prev = workspace.getConfiguration('mcp').get<number>('maxConcurrentRequests', 4)
    workspace.configurations.updateMemoryConfig({ 'mcp.maxConcurrentRequests': 0 })
    lspQueryCache.clear()
    let limiter = getServiceLimiter('test', 0)
    let releases: (() => void)[] = []
    let tasks: Promise<unknown>[] = []
    try {
      for (let i = 0; i < MAX_STUCK_REQUESTS; i++) {
        let token = new CancellationTokenSource()
        let release!: () => void
        let gate = new Promise<void>(resolve => { release = resolve })
        let start!: () => void
        let started = new Promise<void>(resolve => { start = resolve })
        releases.push(release)
        tasks.push(limiter.run(async () => {
          start()
          await gate
        }, token.token))
        await started
        token.cancel()
      }
      assert.strictEqual(limiter.stuckCount, MAX_STUCK_REQUESTS)
      let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      assert.strictEqual(result.isError, true)
      assert.ok((result.content[0].text).includes('stuck requests'))
    } finally {
      for (let release of releases) release()
      await Promise.allSettled(tasks)
      workspace.configurations.updateMemoryConfig({ 'mcp.maxConcurrentRequests': prev })
      assert.strictEqual(limiter.stuckCount, 0)
    }
  })

  describe('result limits', () => {
    let manyFile: string
    let manyUri: string

    beforeAll(async () => {
      manyFile = path.join(tmpdir, 'many.vim')
      fs.writeFileSync(manyFile, Array.from({ length: 250 }, () => 'let a = 1').join('\n') + '\n')
      manyUri = URI.file(manyFile).toString()
      await helper.nvim.command(`edit ${manyFile}`)
      await helper.nvim.command('setfiletype vim')
      await helper.waitValue(() => !!workspace.getDocument(manyUri), true)
      await helper.waitValue(() => workspace.getDocument(manyUri)!.languageId, 'vim')
      let range = Range.create(Position.create(0, 0), Position.create(1000, 0))
      await waitFor(() => {
        let doc = workspace.getDocument(manyUri)
        return doc ? diagnosticManager.getDiagnosticsInRange(doc.textDocument, range).length >= 100 : false
      })
    })

    it('lsp/references truncates at the default 200 and reports totals', async () => {
      let result = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 } }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.count, 250)
      assert.strictEqual(result.structuredContent.returned, 200)
      assert.strictEqual(result.structuredContent.truncated, true)
      assert.strictEqual((result.structuredContent.locations).length, 200)
      assert.ok((result.content[0].text).includes('200 of 250 results'))
      assert.ok((result.content[0].text).includes('truncated'))
    })

    it('lsp/references honors maxResults, clamps to hard limit, and validates input', async () => {
      let limited = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 50 }, { token })
      assert.strictEqual(limited.structuredContent.returned, 50)
      assert.strictEqual(limited.structuredContent.count, 250)
      assert.strictEqual(limited.structuredContent.truncated, true)
      let all = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 5000 }, { token })
      assert.strictEqual(all.structuredContent.returned, 250)
      assert.strictEqual(all.structuredContent.truncated, false)
      let fallback = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 'many' as any }, { token })
      assert.strictEqual(fallback.structuredContent.returned, 200)
      assert.strictEqual(fallback.structuredContent.truncated, true)
    })

    it('lsp/document_symbols truncates at the default 500', async () => {
      let result = await tool('lsp/document_symbols').handler({ uri: manyFile }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.count, 600)
      assert.strictEqual(result.structuredContent.returned, 500)
      assert.strictEqual(result.structuredContent.truncated, true)
      assert.strictEqual((result.structuredContent.symbols).length, 500)
    })

    it('lsp/workspace_symbols truncates at the default 500', async () => {
      let result = await tool('lsp/workspace_symbols').handler({ query: 'many' }, { token })
      assert.ok(!(result.isError))
      assert.ok((result.structuredContent.count) >= (600))
      assert.strictEqual(result.structuredContent.returned, 500)
      assert.strictEqual(result.structuredContent.truncated, true)
      assert.strictEqual((result.structuredContent.symbols).length, 500)
    })

    it('lsp/diagnostics truncates at the default 100', async () => {
      let result = await tool('lsp/diagnostics').handler({ uri: manyFile }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.count, 150)
      assert.strictEqual(result.structuredContent.returned, 100)
      assert.strictEqual(result.structuredContent.truncated, true)
      assert.strictEqual((result.structuredContent.diagnostics).length, 100)
    })

    it('lsp/code_actions truncates at the default 100', async () => {
      let result = await tool('lsp/code_actions').handler({ uri: manyFile }, { token })
      assert.ok(!(result.isError))
      assert.strictEqual(result.structuredContent.count, 150)
      assert.strictEqual(result.structuredContent.returned, 100)
      assert.strictEqual(result.structuredContent.truncated, true)
      assert.strictEqual((result.structuredContent.actions).length, 100)
    })
  })
})
