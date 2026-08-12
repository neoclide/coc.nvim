'use strict'
import { mock } from 'node:test'
import type { Mock as NodeMock } from 'node:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Diagnostic, DiagnosticSeverity, Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import diagnosticManager from '../../diagnostic/manager'
import languages from '../../languages'
import { createDocumentTools } from '../../mcp/tools/document'
import { editorStateParams, NotificationManager, serviceStateParams } from '../../mcp/notifications'
import { ResourceManager } from '../../mcp/resources'
import { McpServer } from '../../mcp/server'
import { ToolRegistry } from '../../mcp/tools'
import services, { ServiceStat } from '../../services'
import helper from '../helper'
import { CancellationToken, Emitter } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { TestClient } from './testClient'

let disposables: { dispose(): void }[] = []
let tmpdir: string
let file: string
let uri: string
let server: McpServer
let notifications: NotificationManager
let address: { host: string, port: number, socketPath: string }
let client: TestClient
let cursorSpy: NodeMock<any>
const token = CancellationToken.None

async function connect(): Promise<TestClient> {
  let c = new TestClient(address.port)
  await c.request(0, 'coc/auth', { token: 'notify-token', clientInfo: { name: 'test', version: '1' } })
  await c.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  c.notify('notifications/initialized')
  return c
}

beforeAll(async () => {
  await helper.setup()
  // The diagnostic update chain fires a fire-and-forget nvim request through
  // DiagnosticBuffer.checkFloat -> window.getCursorPosition. Mock the cursor
  // lookup so that request cannot still be pending when afterAll detaches the
  // transport, which otherwise surfaces as an unhandled "transport
  // disconnected" rejection on slow CI. The mock must stay active through
  // afterAll because disposing the diagnostic collection fires the same chain.
  cursorSpy = mock.method(window, 'getCursorPosition', () => Promise.resolve(Position.create(0, 0)))
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-notify-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.txt')
  fs.writeFileSync(file, 'alpha\nbeta\n')
  uri = URI.file(file).toString()
  await helper.nvim.command(`edit ${file}`)
  await helper.waitValue(() => !!workspace.getDocument(uri), true)
  let registry = new ToolRegistry()
  for (let tool of createDocumentTools()) registry.register(tool)
  server = new McpServer({
    transport: 'tcp',
    host: '127.0.0.1',
    port: 0,
    token: 'notify-token',
    authRequired: true,
    maxClients: 4,
    timeout: 1000
  }, registry, new ResourceManager())
  address = await server.listen()
  notifications = new NotificationManager(server)
  client = await connect()
})

afterAll(async () => {
  client.close()
  server.dispose()
  notifications.dispose()
  for (let d of disposables) d.dispose()
  await helper.shutdown()
  cursorSpy.mock.restore()
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

describe('mcp notifications and resources', () => {
  it('builds editor and service notification payloads', () => {
    assert.deepStrictEqual(editorStateParams(null), { uri: null, bufnr: null, languageId: null })
    assert.deepStrictEqual(editorStateParams({ uri: 'file:///a', bufnr: 1 }), { uri: 'file:///a', bufnr: 1, languageId: null })
    assert.deepStrictEqual(editorStateParams({ uri: 'file:///a', bufnr: 1, document: { languageId: 'vim' } }), {
      uri: 'file:///a', bufnr: 1, languageId: 'vim'
    })
    let stat = { id: 'test', languageIds: ['vim'] }
    assert.deepStrictEqual(serviceStateParams(stat), { id: 'test', state: 'running', languageIds: ['vim'] })
    assert.deepStrictEqual(serviceStateParams(stat, { state: ServiceStat.Stopped }), { id: 'test', state: 'stopped', languageIds: ['vim'] })
  })

  it('delivers coc/document_saved to subscribed sessions', async () => {
    let sub = await client.request(10, 'coc/subscribe', { events: ['coc/document_saved'] })
    assert.deepStrictEqual(sub.subscribed, ['coc/document_saved'])
    let notified = client.waitNotification('coc/document_saved')
    await helper.nvim.command('write')
    let msg = await notified
    assert.strictEqual(msg.params.uri, uri)
    assert.strictEqual(typeof msg.params.version, 'number')
  })

  it('does not deliver events after unsubscribe', async () => {
    await client.request(11, 'coc/unsubscribe', { events: ['coc/document_saved'] })
    // broadcast directly (synchronous on the server side), then flush via ping
    server.broadcastEvent('coc/document_saved', { uri, version: 99 })
    await client.request(12, 'ping')
    assert.strictEqual((client.notifications.filter(n => n.method === 'coc/document_saved')).length, 0)
  })

  it('delivers coc/document_saved after apply_edits target both', async () => {
    await client.request(13, 'coc/subscribe', { events: ['coc/document_saved'] })
    let notified = client.waitNotification('coc/document_saved')
    let doc = workspace.getDocument(uri)!
    let before = doc.textDocument.getText()
    let result = await createDocumentTools().find(t => t.name === 'document/apply_edits')!.handler({
      uri: file,
      version: doc.version,
      target: 'both',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'prefixed-' }]
    }, { token })
    assert.ok(!(result.isError))
    let msg = await notified
    assert.strictEqual(msg.params.uri, uri)
    // restore content so later tests are unaffected
    let restore = await createDocumentTools().find(t => t.name === 'document/apply_edits')!.handler({
      uri: file,
      target: 'both',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, newText: '' }]
    }, { token })
    assert.ok(!(restore.isError))
  })

  it('delivers coc/diagnostics_changed when diagnostics are set', async () => {
    await client.request(20, 'coc/subscribe', { events: ['coc/diagnostics_changed'] })
    let notified = client.waitNotification('coc/diagnostics_changed')
    let collection = languages.createDiagnosticCollection('mcp-notify-test')
    disposables.push(collection)
    collection.set(uri, [Diagnostic.create(Range.create(0, 0, 0, 5), 'notify diagnostic', DiagnosticSeverity.Error)])
    let msg = await notified
    assert.strictEqual(msg.params.uri, uri)
    assert.ok((msg.params.diagnostics.length) > (0))
  })

  it('lists resources and templates', async () => {
    let list = await client.request(30, 'resources/list')
    let uris = list.resources.map((r: any) => r.uri)
    assert.ok((uris).includes('coc://diagnostics'))
    assert.ok((uris).includes('coc://services'))
    assert.ok((uris).includes('coc://workspace'))
    assert.ok((uris).includes('coc://documents/' + encodeURIComponent(uri)))
    let templates = await client.request(31, 'resources/templates/list')
    assert.strictEqual(templates.resourceTemplates[0].uriTemplate, 'coc://documents/{uri}')
  })

  it('coc://documents/{uri} matches document/read', async () => {
    let resourceUri = 'coc://documents/' + encodeURIComponent(uri)
    let read = await client.request(32, 'resources/read', { uri: resourceUri })
    assert.strictEqual(read.contents[0].text, 'alpha\nbeta\n')
    let docTool = createDocumentTools().find(t => t.name === 'document/read')!
    let result = await docTool.handler({ uri: file }, { token })
    assert.strictEqual(read.contents[0].text, result.structuredContent.text)
  })

  it('coc://documents/{uri} falls back to disk for unopened files', async () => {
    let other = path.join(tmpdir, 'resource-unopened.txt')
    fs.writeFileSync(other, 'resource disk\n')
    let resourceUri = 'coc://documents/' + encodeURIComponent(URI.file(other).toString())
    let read = await client.request(37, 'resources/read', { uri: resourceUri })
    assert.strictEqual(read.contents[0].text, 'resource disk\n')
  })

  it('returns -32002 when a document resource cannot be read from disk', async () => {
    let missing = path.join(tmpdir, 'missing-resource.txt')
    let resourceUri = 'coc://documents/' + encodeURIComponent(URI.file(missing).toString())
    await assert.rejects(client.request(38, 'resources/read', { uri: resourceUri }), error => String(error instanceof Error ? error.message : error).includes('-32002'))
  })

  it('returns -32002 when a document resource is denied by path policy', async () => {
    let denied = path.join(tmpdir, 'denied-resource.txt')
    workspace.configurations.updateMemoryConfig({ 'mcp.deniedPaths': [denied] })
    try {
      let resourceUri = 'coc://documents/' + encodeURIComponent(URI.file(denied).toString())
      await assert.rejects(client.request(39, 'resources/read', { uri: resourceUri }), error => String(error instanceof Error ? error.message : error).includes('-32002'))
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.deniedPaths': [] })
    }
  })

  it('reads coc://diagnostics, coc://services and coc://workspace', async () => {
    let diag = await client.request(33, 'resources/read', { uri: 'coc://diagnostics' })
    assert.strictEqual(typeof diag.contents[0].text, 'string')
    let servicesRead = await client.request(34, 'resources/read', { uri: 'coc://services' })
    assert.strictEqual(typeof servicesRead.contents[0].text, 'string')
    let ws = await client.request(35, 'resources/read', { uri: 'coc://workspace' })
    assert.ok((ws.contents[0].text).includes('"root"'))
  })

  it('returns -32002 for unknown resources', async () => {
    let error: any
    try {
      await client.request(36, 'resources/read', { uri: 'coc://nope' })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32002'))
  })

  it('filters non-coc events on subscribe', async () => {
    let sub = await client.request(40, 'coc/subscribe', {
      events: ['coc/document_saved', 'not-a-coc-event']
    })
    assert.deepStrictEqual(sub.subscribed, ['coc/document_saved'])
  })

  it('delivers coc/workspace_folders_changed', async () => {
    await client.request(41, 'coc/subscribe', { events: ['coc/workspace_folders_changed'] })
    let notified = client.waitNotification('coc/workspace_folders_changed')
    let otherDir = path.join(tmpdir, 'nested-folder')
    fs.mkdirSync(otherDir, { recursive: true })
    workspace.workspaceFolderControl.addWorkspaceFolder(otherDir, true)
    let msg = await notified
    assert.ok((msg.params.added.map((f: any) => f.uri)).includes(URI.file(otherDir).toString()))
  })

  it('delivers coc/service_state_changed when a registered service becomes ready', async () => {
    let ready = new Emitter<void>()
    let serviceDisposable = services.register({
      id: 'mcp-notification-test-service',
      name: 'MCP notification test service',
      state: ServiceStat.Running,
      selector: [{ language: 'text' }],
      onServiceReady: ready.event,
      start: () => {},
      stop: () => {},
      restart: () => {},
      dispose: () => {}
    })
    let manager = new NotificationManager(server)
    try {
      let resource = await client.request(43, 'resources/read', { uri: 'coc://services' })
      let stats = JSON.parse(resource.contents[0].text)
      let stat = stats.find((item: any) => item.id === 'mcp-notification-test-service')
      assert.strictEqual(stat.state, 'running')
      assert.strictEqual(stat.capabilities, null)
      await client.request(42, 'coc/subscribe', { events: ['coc/service_state_changed'] })
      let notified = client.waitNotification('coc/service_state_changed')
      ready.fire()
      let msg = await notified
      assert.deepStrictEqual(msg.params, {
        id: 'mcp-notification-test-service',
        state: 'running',
        languageIds: ['text']
      })
    } finally {
      manager.dispose()
      serviceDisposable.dispose()
      ready.dispose()
    }
  })
})
