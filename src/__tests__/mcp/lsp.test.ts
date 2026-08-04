'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import { Position, Range } from 'vscode-languageserver-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import commands from '../../commands'
import diagnosticManager from '../../diagnostic/manager'
import events from '../../events'
import { createLspTools, getServiceLimiter, lspQueryCache, withServiceLimit } from '../../mcp/tools/lsp'
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
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.hovers[0].contents).toContain('foo')
  })

  it('lsp/definition returns locations', async () => {
    let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(1)
    let loc = result.structuredContent.locations[0]
    expect(loc.uri).toBe(uri)
    expect(loc.range.start.line).toBe(0)
  })

  it('lsp/references returns locations', async () => {
    let result = await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(2)
  })

  it('lsp/hover uses the configured service for the language', async () => {
    let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.hovers[0].contents).toContain('foo')
  })

  it('lsp/signature_help uses the configured service for the language', async () => {
    let result = await tool('lsp/signature_help').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.signatures[0].label).toBe('label')
  })

  it('lsp/definition uses the configured service for the language', async () => {
    let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(1)
    let loc = result.structuredContent.locations[0]
    expect(loc.uri).toBe(uri)
    expect(loc.range.start.line).toBe(0)
  })

  it('lsp/references uses the configured service for the language', async () => {
    let result = await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(2)
  })

  it('lsp/definition with a missing configured service returns error', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'missing' } })
    try {
      let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      expect(result.isError).toBeTruthy()
      expect(result.content[0].text).toContain('missing')
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
    }
  })

  it('lsp/signature_help returns signature labels', async () => {
    let result = await tool('lsp/signature_help').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.signatures[0].label).toBe('label')
    expect(result.structuredContent.activeSignature).toBe(1)
  })

  it('lsp/document_symbols returns flattened symbols', async () => {
    let result = await tool('lsp/document_symbols').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.symbols[0].name).toBe('name')
    expect(result.structuredContent.symbols[0].kind).toBe('Method')
  })

  it('lsp/document_symbols uses the configured service for the language', async () => {
    let result = await tool('lsp/document_symbols').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.symbols[0].name).toBe('name')
    expect(result.structuredContent.symbols[0].kind).toBe('Method')
  })

  it('lsp/workspace_symbols searches by query', async () => {
    let result = await tool('lsp/workspace_symbols').handler({ query: 'name' }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.symbols[0].name).toBe('name')
  })

  it('lsp/diagnostics returns the current list (empty here)', async () => {
    let result = await tool('lsp/diagnostics').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(1)
    expect(result.structuredContent.diagnostics[0].message).toBe('diagnostic')
  })

  it('lsp/code_actions lists actions without applying', async () => {
    let result = await tool('lsp/code_actions').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    let titles = result.structuredContent.actions.map((a: any) => a.title)
    expect(titles).toContain('title')
    expect(titles).toContain('other title')
  })

  it('lsp/apply_code_action applies the selected action', async () => {
    let result = await tool('lsp/apply_code_action').handler({ uri: file, title: 'title' }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.applied).toBe(true)
    expect(result.structuredContent.actions).toContain('command')
  })

  it('lsp/rename previews and applies', async () => {
    let preview = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed', preview: true }, { token })
    expect(preview.isError).toBeFalsy()
    expect(preview.structuredContent.preview).toBe(true)
    expect(preview.structuredContent.edit).toBeTruthy()
    let applied = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed' }, { token })
    expect(applied.isError).toBeFalsy()
    expect(applied.structuredContent.applied).toBe(true)
  })

  it('lsp/rename uses the configured service for the language', async () => {
    let preview = await tool('lsp/rename').handler({ uri: file, position: { line: 1, character: 1 }, newName: 'renamed', preview: true }, { token })
    expect(preview.isError).toBeFalsy()
    expect(preview.structuredContent.preview).toBe(true)
    expect(preview.structuredContent.edit).toBeTruthy()
  })

  it('falls back to provider aggregation when no service is configured', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
    try {
      let result = await tool('lsp/definition').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBe(1)
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
    expect(result.isError).toBeFalsy()
    let results = result.structuredContent.results
    expect(results.hover.hovers[0].contents).toContain('foo')
    expect(results.definition.count).toBe(1)
    expect(results.references.count).toBe(2)
    expect(results.document_symbols.symbols[0].name).toBe('name')
  })

  it('lsp/batch rejects unknown methods', async () => {
    let result = await tool('lsp/batch').handler({
      uri: file,
      position: { line: 1, character: 1 },
      methods: ['hover', 'bogus']
    }, { token })
    expect(result.isError).toBeTruthy()
    expect(result.content[0].text).toContain('bogus')
  })

  it('lsp/batch allows document_symbols without position', async () => {
    let result = await tool('lsp/batch').handler({ uri: file, methods: ['document_symbols'] }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.results.document_symbols.symbols[0].name).toBe('name')
  })

  it('lsp tools disable language client trace for agent calls', async () => {
    let client = services.getService('test')!.client as any
    client.trace = Trace.Messages
    let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(result.isError).toBeFalsy()
    expect(client._trace).toBe(Trace.Off)
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
    expect(maxActive).toBe(2)
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
    expect(maxActive).toBe(4)
  })

  it('lsp/execute_command runs workspace/executeCommand on the server', async () => {
    let result = await tool('lsp/execute_command').handler({ serviceId: 'test', command: 'test_command' }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.result).toEqual({ success: true })
  })

  it('lsp/request passes through arbitrary LSP methods', async () => {
    let result = await tool('lsp/request').handler({ serviceId: 'test', method: 'workspace/symbol', params: { query: 'x' } }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.result[0].name).toBe('name')
  })

  it('lsp/request and lsp/execute_command return friendly errors for unknown services', async () => {
    let requestResult = await tool('lsp/request').handler({ serviceId: 'missing', method: 'workspace/symbol' }, { token })
    expect(requestResult.isError).toBe(true)
    expect(requestResult.content[0].text).toContain('not found')
    let commandResult = await tool('lsp/execute_command').handler({ serviceId: 'missing', command: 'x' }, { token })
    expect(commandResult.isError).toBe(true)
    expect(commandResult.content[0].text).toContain('not found')
  })

  it('lsp/capabilities lists servers with initialize capabilities', async () => {
    let result = await tool('lsp/capabilities').handler({}, { token })
    expect(result.isError).toBeFalsy()
    let server = result.structuredContent.services.find((s: any) => s.id === 'languageserver.test')
    expect(server).toBeTruthy()
    expect(server.state).toBe('running')
    expect(server.capabilities.definitionProvider).toBe(true)
  })

  it('returns a friendly error when no provider exists', async () => {
    let other = path.join(tmpdir, 'other.txt')
    fs.writeFileSync(other, 'plain\n')
    await helper.nvim.command(`edit ${other}`)
    await helper.waitValue(() => !!workspace.getDocument(URI.file(other).toString()), true)
    let result = await tool('lsp/hover').handler({ uri: other, position: { line: 0, character: 0 } }, { token })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('provider not found')
  })

  it('caches idempotent queries and invalidates on document change', async () => {
    lspQueryCache.clear()
    let first = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(first.isError).toBeFalsy()
    expect(lspQueryCache.size).toBe(1)
    // identical query is served from the cache, no new entry
    let second = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(second.isError).toBeFalsy()
    expect(second.structuredContent.hovers[0].contents).toContain('foo')
    expect(lspQueryCache.size).toBe(1)
    // lsp/batch reuses the same cache entry for the same query
    await tool('lsp/batch').handler({ uri: file, position: { line: 1, character: 1 }, methods: ['hover'] }, { token })
    expect(lspQueryCache.size).toBe(1)
    // a different position is a distinct entry
    await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 2 } }, { token })
    expect(lspQueryCache.size).toBe(2)
    // references with and without declaration are distinct entries
    await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 }, includeDeclaration: true }, { token })
    await tool('lsp/references').handler({ uri: file, position: { line: 1, character: 1 }, includeDeclaration: false }, { token })
    expect(lspQueryCache.size).toBe(4)
    // editing the buffer clears every cached entry for the document
    await helper.nvim.command(`edit ${file}`)
    await helper.nvim.call('setline', [1, 'let a = 2'])
    await helper.waitValue(() => lspQueryCache.size, 0)
    // the next query repopulates the cache with the new document version
    let after = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
    expect(after.isError).toBeFalsy()
    expect(after.structuredContent.hovers[0].contents).toContain('foo')
    expect(lspQueryCache.size).toBe(1)
  })

  it('does not cache error results', async () => {
    lspQueryCache.clear()
    let otherUri = URI.file(path.join(tmpdir, 'other.txt')).toString()
    let first = await tool('lsp/hover').handler({ uri: otherUri, position: { line: 0, character: 0 } }, { token })
    expect(first.isError).toBe(true)
    expect(lspQueryCache.size).toBe(0)
    let second = await tool('lsp/hover').handler({ uri: otherUri, position: { line: 0, character: 0 } }, { token })
    expect(second.isError).toBe(true)
    expect(lspQueryCache.size).toBe(0)
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
      expect(limiter.stuckCount).toBe(limit)
      let result = await tool('lsp/hover').handler({ uri: file, position: { line: 1, character: 1 } }, { token })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('stuck requests')
    } finally {
      for (let release of releases) release()
      await Promise.allSettled(tasks)
      expect(limiter.stuckCount).toBe(0)
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
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBe(250)
      expect(result.structuredContent.returned).toBe(200)
      expect(result.structuredContent.truncated).toBe(true)
      expect(result.structuredContent.locations).toHaveLength(200)
      expect(result.content[0].text).toContain('200 of 250 results')
      expect(result.content[0].text).toContain('truncated')
    })

    it('lsp/references honors maxResults, clamps to hard limit, and validates input', async () => {
      let limited = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 50 }, { token })
      expect(limited.structuredContent.returned).toBe(50)
      expect(limited.structuredContent.count).toBe(250)
      expect(limited.structuredContent.truncated).toBe(true)
      let all = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 5000 }, { token })
      expect(all.structuredContent.returned).toBe(250)
      expect(all.structuredContent.truncated).toBe(false)
      let fallback = await tool('lsp/references').handler({ uri: manyFile, position: { line: 1, character: 1 }, maxResults: 'many' as any }, { token })
      expect(fallback.structuredContent.returned).toBe(200)
      expect(fallback.structuredContent.truncated).toBe(true)
    })

    it('lsp/document_symbols truncates at the default 500', async () => {
      let result = await tool('lsp/document_symbols').handler({ uri: manyFile }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBe(600)
      expect(result.structuredContent.returned).toBe(500)
      expect(result.structuredContent.truncated).toBe(true)
      expect(result.structuredContent.symbols).toHaveLength(500)
    })

    it('lsp/workspace_symbols truncates at the default 500', async () => {
      let result = await tool('lsp/workspace_symbols').handler({ query: 'many' }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBeGreaterThanOrEqual(600)
      expect(result.structuredContent.returned).toBe(500)
      expect(result.structuredContent.truncated).toBe(true)
      expect(result.structuredContent.symbols).toHaveLength(500)
    })

    it('lsp/diagnostics truncates at the default 100', async () => {
      let result = await tool('lsp/diagnostics').handler({ uri: manyFile }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBe(150)
      expect(result.structuredContent.returned).toBe(100)
      expect(result.structuredContent.truncated).toBe(true)
      expect(result.structuredContent.diagnostics).toHaveLength(100)
    })

    it('lsp/code_actions truncates at the default 100', async () => {
      let result = await tool('lsp/code_actions').handler({ uri: manyFile }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.count).toBe(150)
      expect(result.structuredContent.returned).toBe(100)
      expect(result.structuredContent.truncated).toBe(true)
      expect(result.structuredContent.actions).toHaveLength(100)
    })
  })
})
