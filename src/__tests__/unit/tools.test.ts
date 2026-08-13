'use strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ToolRegistry } from '../../mcp/tools'
import { createWorkspaceTools } from '../../mcp/tools/workspace'
import { collectEditUris, errorResult, globVariants, textContent, textResult, toFsPath, toUri } from '../../mcp/tools/util'
import { CancellationToken } from '../../util/protocol'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('mcp workspace tools', () => {
  it('workspace/info returns editor state without a running nvim', async () => {
    let tools = createWorkspaceTools()
    let info = tools.find(t => t.name === 'workspace/info')!
    let result = await info.handler({}, { token: CancellationToken.None })
    assert.ok(result.structuredContent.version)
    assert.ok(result.structuredContent.cwd)
    assert.strictEqual(Array.isArray(result.structuredContent.services), true)
    assert.strictEqual(result.content[0].type, 'text')
  })

  it('workspace/configuration reads defaults from the schema', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.autoStart' }, { token: CancellationToken.None })
    assert.strictEqual(result.structuredContent.key, 'mcp.autoStart')
    assert.strictEqual(result.structuredContent.value, false)
    assert.ok(result.structuredContent.inspect)
  })

  it('workspace/configuration returns undefined for unknown keys', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.notARealKey' }, { token: CancellationToken.None })
    assert.strictEqual(result.structuredContent.value, undefined)
  })
})

describe('mcp tool utilities', () => {
  it('builds results and normalizes uris', () => {
    assert.deepStrictEqual(textResult('hello'), {
      content: [{ type: 'text', text: 'hello' }]
    })
    assert.deepStrictEqual(textResult('hello', { ok: true }), {
      content: [{ type: 'text', text: 'hello' }],
      structuredContent: { ok: true }
    })
    assert.deepStrictEqual(textContent('hello'), { type: 'text', text: 'hello' })
    assert.deepStrictEqual(errorResult('boom'), {
      content: [{ type: 'text', text: 'boom' }],
      isError: true
    })

    const input = path.join(process.cwd(), 'src')
    const uri = toUri(input)
    assert.ok(uri.startsWith('file://'))
    assert.strictEqual(toFsPath(uri), input)
    assert.strictEqual(toUri('https://example.com/a'), 'https://example.com/a')
  })

  it('collects edit uris and adds symlink glob variants', (t) => {
    const uris = collectEditUris({
      changes: {
        'file:///a.ts': [],
        'file:///b.ts': []
      },
      documentChanges: [
        { textDocument: { uri: 'file:///c.ts' } },
        { uri: 'file:///d.ts' },
        { oldUri: 'file:///e.ts', newUri: 'file:///f.ts' },
        null
      ]
    })
    assert.deepStrictEqual(uris, [
      'file:///a.ts',
      'file:///b.ts',
      'file:///c.ts',
      'file:///d.ts',
      'file:///e.ts',
      'file:///f.ts'
    ])

    if (process.platform === 'win32') {
      t.skip('symlink test is posix-only')
      return
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-glob-'))
    const target = path.join(root, 'real')
    const link = path.join(root, 'link')
    fs.mkdirSync(target)
    fs.symlinkSync(target, link, 'dir')
    const variants = globVariants(link + '/**')
    assert.strictEqual(variants[0], link + '/**')
    assert.strictEqual(
      variants[1],
      path.join(fs.realpathSync(link), '**')
    )
    fs.rmSync(root, {recursive: true, force: true})
  })
})

describe('mcp ToolRegistry whitelist', () => {
  function sampleRegistry(): ToolRegistry {
    let registry = new ToolRegistry()
    registry.register({
      name: 'a',
      description: 'tool a',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'a' }] })
    })
    registry.register({
      name: 'b',
      description: 'tool b',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'b' }] })
    })
    return registry
  }

  it('allows every tool by default', () => {
    let registry = sampleRegistry()
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a', 'b'])
    assert.strictEqual(registry.has('a'), true)
    assert.notStrictEqual(registry.get('b'), undefined)
  })

  it('hides tools outside the whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a'])
    assert.strictEqual(registry.has('a'), true)
    assert.strictEqual(registry.has('b'), false)
    assert.strictEqual(registry.get('b'), undefined)
  })

  it('exposes no tools when the whitelist is empty', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools([])
    assert.deepStrictEqual(registry.list().tools, [])
    assert.strictEqual(registry.has('a'), false)
    assert.strictEqual(registry.isAllowed('a'), false)
  })

  it('rejects calls to blocked tools', async () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    await assert.rejects(registry.call('b', {}, { token: CancellationToken.None }), /Unknown tool/)
    let result = await registry.call('a', {}, { token: CancellationToken.None })
    assert.strictEqual(result.content[0].text, 'a')
  })

  it('restores full access with a null whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    registry.setAllowedTools(null)
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a', 'b'])
  })

  it('clears registered tools on dispose', () => {
    let registry = sampleRegistry()
    registry.unregister('missing')
    registry.dispose()
    assert.deepStrictEqual(registry.list().tools, [])
  })
})
