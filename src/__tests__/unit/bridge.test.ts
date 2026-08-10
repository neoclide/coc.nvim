'use strict'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FrameSplitter } from '../../mcp/framing'
import { McpServer } from '../../mcp/server'
import { ToolRegistry } from '../../mcp/tools'

const bridgePath = path.resolve(__dirname, '../../../bin/coc-mcp.js')

interface BridgeClient {
  proc: import('child_process').ChildProcess
  frames: any[]
  waiters: Map<number | string, { resolve: (msg: any) => void, reject: (err: Error) => void }>
  splitter: FrameSplitter
}

async function waitFor(fn: () => boolean, timeout = 5000): Promise<void> {
  let start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function waitNotification(client: BridgeClient, method: string): Promise<any> {
  await waitFor(() => client.frames.some(frame => frame.method === method))
  let index = client.frames.findIndex(frame => frame.method === method)
  return client.frames.splice(index, 1)[0]
}

async function requestTools(client: BridgeClient, request: (id: number | string, method: string, params?: any) => Promise<any>, id: number): Promise<any> {
  let result = await request(id, 'tools/list')
  if (result.tools.length === 0) {
    await waitNotification(client, 'notifications/tools/list_changed')
    result = await request(id + 1000, 'tools/list')
  }
  return result
}

describe('coc-mcp stdio bridge', () => {
  let server: McpServer
  let address: { host: string, port: number, socketPath: string }
  let dir: string

  afterAll(() => {
    if (server) server.dispose()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (_e) {
      // ignore
    }
  })

  it('relays MCP messages between codex stdio and the coc socket', async () => {
    let registry = new ToolRegistry()
    registry.register({
      name: 'bridge_echo',
      description: 'Echo for bridge test',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      handler: (args: any) => ({
        content: [{ type: 'text', text: String(args?.value ?? '') }],
        structuredContent: { value: args?.value }
      })
    })
    server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry)
    address = await server.listen()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-bridge-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let file = path.join(dir, 'mcp', `coc-${process.pid}.json`)
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: address.host,
      port: address.port,
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))

    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let client: BridgeClient = {
      proc,
      frames: [],
      waiters: new Map(),
      splitter: new FrameSplitter(1 << 20, msg => onFrame(msg), () => {})
    }
    proc.stdout.on('data', chunk => client.splitter.push(chunk))

    function onFrame(msg: any): void {
      if (msg.id !== undefined && client.waiters.has(msg.id)) {
        let waiter = client.waiters.get(msg.id)!
        client.waiters.delete(msg.id)
        if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
        else waiter.resolve(msg.result)
      } else {
        client.frames.push(msg)
      }
    }

    function request(id: number | string, method: string, params?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        client.waiters.set(id, { resolve, reject })
        let msg: any = { jsonrpc: '2.0', id, method }
        if (params !== undefined) msg.params = params
        proc.stdin.write(JSON.stringify(msg) + '\n')
      })
    }

    let init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'codex-test', version: '1' }
    })
    expect(init.protocolVersion).toBe('2025-06-18')
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    let list = await requestTools(client, request, 2)
    expect(list.tools.map((t: any) => t.name)).toContain('bridge_echo')
    let call = await request(3, 'tools/call', { name: 'bridge_echo', arguments: { value: 'via-bridge' } })
    expect(call.structuredContent.value).toBe('via-bridge')
    proc.stdin.end()

    await new Promise<void>(resolve => {
      proc.on('exit', () => resolve())
    })
    expect(stderr).not.toContain('not available')
    // the bridge reports what the coc.nvim side supports instead of hardcoding it
    expect(stderr).toContain('connected to coc.nvim 0.0.0')
    expect(stderr).toContain('mcp protocol 2025-06-18')
    expect(stderr).toContain('server capabilities: tools')
  })

  it('waits for coc.nvim before completing initialize', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-empty-'))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: emptyDir, COC_MCP_POLL_INTERVAL_MS: '50' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let { request } = attachClient(proc)
    let initialize = request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    await waitFor(() => stderr.includes('retrying'))
    expect(proc.exitCode).toBe(null)

    let registry = new ToolRegistry()
    registry.register({
      name: 'delayed_tool',
      description: 'tool registered after bridge startup',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let delayedServer = new McpServer({
      transport: 'tcp', host: '127.0.0.1', port: 0,
      token: 'delayed-token', authRequired: true, maxClients: 2, timeout: 1000
    }, registry)
    let delayedAddress = await delayedServer.listen()
    fs.writeFileSync(path.join(emptyDir, `coc-${process.pid}.json`), JSON.stringify({
      version: 1, pid: process.pid, transport: 'tcp', host: '127.0.0.1',
      port: delayedAddress.port, token: 'delayed-token', protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' }, cwd: process.cwd()
    }))
    let init = await initialize
    expect(init.capabilities.tools.listChanged).toBe(true)
    let list = await request(2, 'tools/list')
    expect(list.tools.map((tool: any) => tool.name)).toContain('delayed_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    expect(proc.exitCode).toBe(0)
    delayedServer.dispose()
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  it('connects to the instance whose workspace matches the bridge cwd', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-multi-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let workA = path.join(dir, 'proj-a')
    let workB = path.join(dir, 'proj-b')
    fs.mkdirSync(path.join(workA, 'sub'), { recursive: true })
    fs.mkdirSync(workB, { recursive: true })
    let registryA = new ToolRegistry()
    registryA.register({
      name: 'instance_a_tool',
      description: 'instance a',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'a' }] })
    })
    let registryB = new ToolRegistry()
    registryB.register({
      name: 'instance_b_tool',
      description: 'instance b',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'b' }] })
    })
    let serverA = new McpServer({
      transport: 'tcp', host: '127.0.0.1', port: 0,
      token: 'token-a', authRequired: true, maxClients: 2, timeout: 1000
    }, registryA)
    let serverB = new McpServer({
      transport: 'tcp', host: '127.0.0.1', port: 0,
      token: 'token-b', authRequired: true, maxClients: 2, timeout: 1000
    }, registryB)
    let addrA = await serverA.listen()
    let addrB = await serverB.listen()
    function writeInstance(pid: number, port: number, token: string, workspace: string): void {
      fs.writeFileSync(path.join(dir, 'mcp', `coc-${pid}.json`), JSON.stringify({
        version: 1,
        pid,
        transport: 'tcp',
        host: '127.0.0.1',
        port,
        token,
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'coc.nvim', version: '0.0.0' },
        apiVersion: 38,
        cwd: workspace,
        workspaceRoot: workspace
      }))
    }
    writeInstance(process.pid, addrA.port, 'token-a', workA)
    writeInstance(1, addrB.port, 'token-b', workB)
    let proc = spawn(process.execPath, [bridgePath], {
      cwd: path.join(workA, 'sub'),
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let client: BridgeClient = {
      proc,
      frames: [],
      waiters: new Map(),
      splitter: new FrameSplitter(1 << 20, msg => onFrame(msg), () => {})
    }
    proc.stdout.on('data', chunk => client.splitter.push(chunk))
    function onFrame(msg: any): void {
      if (msg.id !== undefined && client.waiters.has(msg.id)) {
        let waiter = client.waiters.get(msg.id)!
        client.waiters.delete(msg.id)
        if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
        else waiter.resolve(msg.result)
      } else {
        client.frames.push(msg)
      }
    }
    function request(id: number | string, method: string, params?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        client.waiters.set(id, { resolve, reject })
        let msg: any = { jsonrpc: '2.0', id, method }
        if (params !== undefined) msg.params = params
        proc.stdin.write(JSON.stringify(msg) + '\n')
      })
    }
    let init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    expect(init.protocolVersion).toBe('2025-06-18')
    let list = await requestTools(client, request, 2)
    let names = list.tools.map((t: any) => t.name)
    expect(names).toContain('instance_a_tool')
    expect(names).not.toContain('instance_b_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    serverA.dispose()
    serverB.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function attachClient(proc: import('child_process').ChildProcess): {
    client: BridgeClient,
    request: (id: number | string, method: string, params?: any) => Promise<any>
  } {
    let client: BridgeClient = {
      proc,
      frames: [],
      waiters: new Map(),
      splitter: new FrameSplitter(1 << 20, msg => onFrame(msg), () => {})
    }
    proc.stdout.on('data', chunk => client.splitter.push(chunk))
    function onFrame(msg: any): void {
      if (msg.id !== undefined && client.waiters.has(msg.id)) {
        let waiter = client.waiters.get(msg.id)!
        client.waiters.delete(msg.id)
        if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
        else waiter.resolve(msg.result)
      } else {
        client.frames.push(msg)
      }
    }
    function request(id: number | string, method: string, params?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        client.waiters.set(id, { resolve, reject })
        let msg: any = { jsonrpc: '2.0', id, method }
        if (params !== undefined) msg.params = params
        proc.stdin.write(JSON.stringify(msg) + '\n')
      })
    }
    return { client, request }
  }

  async function twoInstances(dir: string, workA: string, workB: string) {
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let registryA = new ToolRegistry()
    registryA.register({
      name: 'instance_a_tool',
      description: 'instance a',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'a' }] })
    })
    let registryB = new ToolRegistry()
    registryB.register({
      name: 'instance_b_tool',
      description: 'instance b',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'b' }] })
    })
    let serverA = new McpServer({
      transport: 'tcp', host: '127.0.0.1', port: 0,
      token: 'token-a', authRequired: true, maxClients: 2, timeout: 1000
    }, registryA)
    let serverB = new McpServer({
      transport: 'tcp', host: '127.0.0.1', port: 0,
      token: 'token-b', authRequired: true, maxClients: 2, timeout: 1000
    }, registryB)
    let addrA = await serverA.listen()
    let addrB = await serverB.listen()
    let writeInstance = (pid: number, port: number, token: string, workspace: string): void => {
      fs.writeFileSync(path.join(dir, 'mcp', `coc-${pid}.json`), JSON.stringify({
        version: 1,
        pid,
        transport: 'tcp',
        host: '127.0.0.1',
        port,
        token,
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'coc.nvim', version: '0.0.0' },
        apiVersion: 38,
        cwd: workspace,
        workspaceRoot: workspace,
        startedAt: Date.now()
      }))
    }
    writeInstance(1, addrA.port, 'token-a', workA)
    writeInstance(process.pid, addrB.port, 'token-b', workB)
    return { serverA, serverB }
  }

  it('fails initialize when no instance matches the bridge cwd', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-multi-'))
    let workA = path.join(dir, 'proj-a')
    let workB = path.join(dir, 'proj-b')
    let elsewhere = path.join(dir, 'elsewhere')
    fs.mkdirSync(workA, { recursive: true })
    fs.mkdirSync(workB, { recursive: true })
    fs.mkdirSync(elsewhere, { recursive: true })
    let { serverA, serverB } = await twoInstances(dir, workA, workB)
    let proc = spawn(process.execPath, [bridgePath], {
      cwd: elsewhere,
      env: {
        ...process.env,
        COC_MCP_DIR: path.join(dir, 'mcp'),
        COC_MCP_POLL_INTERVAL_MS: '20',
        COC_MCP_STARTUP_TIMEOUT_MS: '100'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let { request } = attachClient(proc)
    await expect(request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })).rejects.toThrow(/unavailable after 100ms/)
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    expect(proc.exitCode).toBe(2)
    expect(stderr).toContain('no instance matches cwd')
    serverA.dispose()
    serverB.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('connects to the first available instance with --match-first', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-multi-'))
    let workA = path.join(dir, 'proj-a')
    let workB = path.join(dir, 'proj-b')
    fs.mkdirSync(workA, { recursive: true })
    fs.mkdirSync(workB, { recursive: true })
    let { serverA, serverB } = await twoInstances(dir, workA, workB)
    let proc = spawn(process.execPath, [bridgePath, '--match-first'], {
      cwd: '/',
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { client, request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await requestTools(client, request, 2)
    let names = list.tools.map((t: any) => t.name)
    expect(names).toContain('instance_a_tool')
    expect(names).not.toContain('instance_b_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    serverA.dispose()
    serverB.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('connects to the first cwd-matching instance with --match-cwd', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-multi-'))
    let workA = path.join(dir, 'proj-a')
    let workB = path.join(dir, 'proj-b')
    fs.mkdirSync(workA, { recursive: true })
    fs.mkdirSync(path.join(workB, 'sub'), { recursive: true })
    let { serverA, serverB } = await twoInstances(dir, workA, workB)
    let proc = spawn(process.execPath, [bridgePath, '--match-cwd'], {
      cwd: path.join(workB, 'sub'),
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { client, request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await requestTools(client, request, 2)
    let names = list.tools.map((t: any) => t.name)
    expect(names).toContain('instance_b_tool')
    expect(names).not.toContain('instance_a_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    serverA.dispose()
    serverB.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reconnects when the discovery file is rewritten after a restart', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-bridge-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let registry = new ToolRegistry()
    registry.register({
      name: 'before_restart',
      description: 'before restart',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let firstServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'token-before',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry)
    let firstAddress = await firstServer.listen()
    let file = path.join(dir, 'mcp', `coc-${process.pid}.json`)
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: firstAddress.port,
      token: 'token-before',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { client, request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let before = await requestTools(client, request, 2)
    expect(before.tools.map((t: any) => t.name)).toContain('before_restart')
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    // simulate coc.nvim restarting: the old server goes away and a new one
    // rewrites the discovery file with a new endpoint and token
    firstServer.dispose()
    await waitFor(() => stderr.includes('disconnected'))
    let registry2 = new ToolRegistry()
    registry2.register({
      name: 'after_restart',
      description: 'after restart',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let secondServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'token-after',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry2)
    let secondAddress = await secondServer.listen()
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: secondAddress.port,
      token: 'token-after',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))
    let changed = await waitNotification(client, 'notifications/tools/list_changed')
    expect(changed.method).toBe('notifications/tools/list_changed')
    // the bridge reconnects and relays requests to the new server
    let after = await requestTools(client, request, 3)
    expect(after.tools.map((t: any) => t.name)).toContain('after_restart')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    secondServer.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cleans stale instance and socket files on scan', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-clean-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let registry = new ToolRegistry()
    registry.register({
      name: 'clean_tool',
      description: 'clean test',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let cleanServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry)
    let addr = await cleanServer.listen()
    let mcpDir = path.join(dir, 'mcp')
    let live = path.join(mcpDir, `coc-${process.pid}.json`)
    fs.writeFileSync(live, JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: addr.port,
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))
    let staleJson = path.join(mcpDir, 'coc-999999999.json')
    let staleSock = path.join(mcpDir, 'coc-999999999.sock')
    fs.writeFileSync(staleJson, '{}')
    fs.writeFileSync(staleSock, '')
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: mcpDir },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { client, request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await requestTools(client, request, 2)
    expect(list.tools.map((t: any) => t.name)).toContain('clean_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    expect(fs.existsSync(staleJson)).toBe(false)
    expect(fs.existsSync(staleSock)).toBe(false)
    expect(fs.existsSync(live)).toBe(true)
    cleanServer.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('authenticates with a private key when the server requires it', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-key-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let registry = new ToolRegistry()
    registry.register({
      name: 'key_tool',
      description: 'key auth test',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let keyServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000,
      authClientPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    }, registry)
    let addr = await keyServer.listen()
    fs.writeFileSync(path.join(dir, 'mcp', `coc-${process.pid}.json`), JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: addr.port,
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))
    let keyFile = path.join(dir, 'key.pem')
    fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    let proc = spawn(process.execPath, [bridgePath], {
      env: {
        ...process.env,
        COC_MCP_DIR: path.join(dir, 'mcp'),
        COC_MCP_AUTH_KEY_FILE: keyFile
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { client, request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await requestTools(client, request, 2)
    expect(list.tools.map((t: any) => t.name)).toContain('key_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    keyServer.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fails initialize when the server requires a key but the bridge has none', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-key-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let keyServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000,
      authClientPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    }, new ToolRegistry())
    let addr = await keyServer.listen()
    fs.writeFileSync(path.join(dir, 'mcp', `coc-${process.pid}.json`), JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: addr.port,
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      cwd: process.cwd(),
      startedAt: Date.now()
    }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: {
        ...process.env,
        COC_MCP_DIR: path.join(dir, 'mcp'),
        COC_MCP_POLL_INTERVAL_MS: '20',
        COC_MCP_STARTUP_TIMEOUT_MS: '100'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let { request } = attachClient(proc)
    await expect(request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })).rejects.toThrow(/unavailable after 100ms/)
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    expect(proc.exitCode).toBe(2)
    expect(stderr).toContain('authentication failed')
    keyServer.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('generates a keypair with --generate-key', async () => {
    let proc = spawn(process.execPath, [bridgePath, '--generate-key'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    proc.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
    })
    let code = await new Promise<number | null>(resolve => proc.on('exit', resolve))
    expect(code).toBe(0)
    expect(stdout).toContain('PRIVATE KEY')
    expect(stdout).toContain('PUBLIC KEY')
    expect(stdout).toContain('BEGIN PRIVATE KEY')
    expect(stdout).toContain('BEGIN PUBLIC KEY')
  })

  it('--connect requires a private key', async () => {
    let proc = spawn(process.execPath, [bridgePath, '--connect=127.0.0.1:9'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let code = await new Promise<number | null>(resolve => proc.on('exit', resolve))
    expect(code).toBe(2)
    expect(stderr).toContain('COC_MCP_AUTH_KEY_FILE')
  })

  it('--connect with public-key auth connects to a forwarded port', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let registry = new ToolRegistry()
    registry.register({
      name: 'ssh_echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      handler: (args: any) => ({
        content: [{ type: 'text', text: String(args?.value ?? '') }],
        structuredContent: { value: args?.value }
      })
    })
    let connectServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'never-used',
      authRequired: true,
      maxClients: 2,
      timeout: 1000,
      authClientPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    }, registry)
    let connectAddress = await connectServer.listen()
    let connectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-connect-'))
    let keyFile = path.join(connectDir, 'key.pem')
    fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    // no discovery file exists: --connect must not need one
    let proc = spawn(process.execPath, [bridgePath, `--connect=127.0.0.1:${connectAddress.port}`], {
      env: {
        ...process.env,
        COC_MCP_DIR: path.join(connectDir, 'mcp'),
        COC_MCP_AUTH_KEY_FILE: keyFile
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let client: BridgeClient = {
      proc,
      frames: [],
      waiters: new Map(),
      splitter: new FrameSplitter(1 << 20, msg => onFrame(msg), () => {})
    }
    proc.stdout.on('data', chunk => client.splitter.push(chunk))
    function onFrame(msg: any): void {
      if (msg.id !== undefined && client.waiters.has(msg.id)) {
        let waiter = client.waiters.get(msg.id)!
        client.waiters.delete(msg.id)
        if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
        else waiter.resolve(msg.result)
      } else {
        client.frames.push(msg)
      }
    }
    function request(id: number | string, method: string, params?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        client.waiters.set(id, { resolve, reject })
        let msg: any = { jsonrpc: '2.0', id, method }
        if (params !== undefined) msg.params = params
        proc.stdin.write(JSON.stringify(msg) + '\n')
      })
    }
    let init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'codex-test', version: '1' }
    })
    expect(init.protocolVersion).toBe('2025-06-18')
    let call = await request(2, 'tools/call', { name: 'ssh_echo', arguments: { value: 'ssh-ok' } })
    expect(call.structuredContent.value).toBe('ssh-ok')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', resolve))
    expect(stderr).toContain('connected to coc.nvim')
    expect(stderr).toContain('--connect')
    connectServer.dispose()
    fs.rmSync(connectDir, { recursive: true, force: true })
  }, 15000)
})
