'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import diagnosticManager from '../../diagnostic/manager'
import languages from '../../languages'
import { createDocumentTools } from '../../mcp/tools/document'
import { NotificationManager } from '../../mcp/notifications'
import { ResourceManager } from '../../mcp/resources'
import { McpServer } from '../../mcp/server'
import { ToolRegistry } from '../../mcp/tools'
import helper from '../helper'
import { CancellationToken } from '../../util/protocol'
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
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

describe('mcp notifications and resources', () => {
  it('delivers coc/document_saved to subscribed sessions', async () => {
    let sub = await client.request(10, 'coc/subscribe', { events: ['coc/document_saved'] })
    expect(sub.subscribed).toEqual(['coc/document_saved'])
    let notified = client.waitNotification('coc/document_saved')
    await helper.nvim.command('write')
    let msg = await notified
    expect(msg.params.uri).toBe(uri)
    expect(typeof msg.params.version).toBe('number')
  })

  it('does not deliver events after unsubscribe', async () => {
    await client.request(11, 'coc/unsubscribe', { events: ['coc/document_saved'] })
    // broadcast directly (synchronous on the server side), then flush via ping
    server.broadcastEvent('coc/document_saved', { uri, version: 99 })
    await client.request(12, 'ping')
    expect(client.notifications.filter(n => n.method === 'coc/document_saved')).toHaveLength(0)
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
    expect(result.isError).toBeFalsy()
    let msg = await notified
    expect(msg.params.uri).toBe(uri)
    // restore content so later tests are unaffected
    let restore = await createDocumentTools().find(t => t.name === 'document/apply_edits')!.handler({
      uri: file,
      target: 'both',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, newText: '' }]
    }, { token })
    expect(restore.isError).toBeFalsy()
  })

  it('delivers coc/diagnostics_changed when diagnostics are set', async () => {
    await client.request(20, 'coc/subscribe', { events: ['coc/diagnostics_changed'] })
    let notified = client.waitNotification('coc/diagnostics_changed')
    let collection = languages.createDiagnosticCollection('mcp-notify-test')
    disposables.push(collection)
    collection.set(uri, [Diagnostic.create(Range.create(0, 0, 0, 5), 'notify diagnostic', DiagnosticSeverity.Error)])
    let msg = await notified
    expect(msg.params.uri).toBe(uri)
    expect(msg.params.diagnostics.length).toBeGreaterThan(0)
  })

  it('lists resources and templates', async () => {
    let list = await client.request(30, 'resources/list')
    let uris = list.resources.map((r: any) => r.uri)
    expect(uris).toContain('coc://diagnostics')
    expect(uris).toContain('coc://services')
    expect(uris).toContain('coc://workspace')
    expect(uris).toContain('coc://documents/' + encodeURIComponent(uri))
    let templates = await client.request(31, 'resources/templates/list')
    expect(templates.resourceTemplates[0].uriTemplate).toBe('coc://documents/{uri}')
  })

  it('coc://documents/{uri} matches document/read', async () => {
    let resourceUri = 'coc://documents/' + encodeURIComponent(uri)
    let read = await client.request(32, 'resources/read', { uri: resourceUri })
    expect(read.contents[0].text).toBe('alpha\nbeta\n')
    let docTool = createDocumentTools().find(t => t.name === 'document/read')!
    let result = await docTool.handler({ uri: file }, { token })
    expect(read.contents[0].text).toBe(result.structuredContent.text)
  })

  it('coc://documents/{uri} falls back to disk for unopened files', async () => {
    let other = path.join(tmpdir, 'resource-unopened.txt')
    fs.writeFileSync(other, 'resource disk\n')
    let resourceUri = 'coc://documents/' + encodeURIComponent(URI.file(other).toString())
    let read = await client.request(37, 'resources/read', { uri: resourceUri })
    expect(read.contents[0].text).toBe('resource disk\n')
  })

  it('reads coc://diagnostics, coc://services and coc://workspace', async () => {
    let diag = await client.request(33, 'resources/read', { uri: 'coc://diagnostics' })
    expect(typeof diag.contents[0].text).toBe('string')
    let servicesRead = await client.request(34, 'resources/read', { uri: 'coc://services' })
    expect(typeof servicesRead.contents[0].text).toBe('string')
    let ws = await client.request(35, 'resources/read', { uri: 'coc://workspace' })
    expect(ws.contents[0].text).toContain('"root"')
  })

  it('returns -32002 for unknown resources', async () => {
    let error: any
    try {
      await client.request(36, 'resources/read', { uri: 'coc://nope' })
    } catch (e) {
      error = e
    }
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32002')
  })

  it('filters non-coc events on subscribe', async () => {
    let sub = await client.request(40, 'coc/subscribe', {
      events: ['coc/document_saved', 'not-a-coc-event']
    })
    expect(sub.subscribed).toEqual(['coc/document_saved'])
  })

  it('delivers coc/workspace_folders_changed', async () => {
    await client.request(41, 'coc/subscribe', { events: ['coc/workspace_folders_changed'] })
    let notified = client.waitNotification('coc/workspace_folders_changed')
    let otherDir = path.join(tmpdir, 'nested-folder')
    fs.mkdirSync(otherDir, { recursive: true })
    workspace.workspaceFolderControl.addWorkspaceFolder(otherDir, true)
    let msg = await notified
    expect(msg.params.added.map((f: any) => f.uri)).toContain(URI.file(otherDir).toString())
  })
})
