'use strict'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FrameSplitter } from '../../mcp/framing'
import { McpServer } from '../../mcp/server'
import { ToolRegistry } from '../../mcp/tools'

const bridgePath = path.resolve(__dirname, '../../../bin/coc-mcp.js')

async function getDeadPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    let s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      let port = (s.address() as net.AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

interface BridgeClient {
  proc: import('child_process').ChildProcess
  frames: any[]
  waiters: Map<number | string, { resolve: (msg: any) => void, reject: (err: Error) => void }>
  splitter: FrameSplitter
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
    let list = await request(2, 'tools/list')
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

  it('exits with code 2 when the discovery file is missing', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-empty-'))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: emptyDir, COC_MCP_WAIT_MS: '300' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let code = await new Promise<number | null>(resolve => {
      proc.on('exit', resolve)
    })
    expect(code).toBe(2)
    expect(stderr).toContain('did not become available')
    expect(stderr).toContain('COC_MCP_WAIT_MS')
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  it('polls until the coc.nvim MCP service appears', async () => {
    let registry = new ToolRegistry()
    registry.register({
      name: 'poll_echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let pollServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry)
    let pollAddress = await pollServer.listen()
    let pollDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-bridge-poll-'))
    fs.mkdirSync(path.join(pollDir, 'mcp'), { recursive: true })
    let file = path.join(pollDir, 'mcp', `coc-${process.pid}.json`)
    let base = {
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      startedAt: Date.now()
    }
    // point at a dead port first, publish the real server after the bridge started
    fs.writeFileSync(file, JSON.stringify({ ...base, port: await getDeadPort() }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: path.join(pollDir, 'mcp'), COC_MCP_WAIT_MS: '12000' },
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
    // let the bridge start polling, then publish the real address
    await new Promise(resolve => setTimeout(resolve, 300))
    fs.writeFileSync(file, JSON.stringify({ ...base, port: pollAddress.port }))
    let init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'codex-test', version: '1' }
    })
    expect(init.protocolVersion).toBe('2025-06-18')
    proc.stdin.end()
    await new Promise<void>(resolve => {
      proc.on('exit', () => resolve())
    })
    expect(stderr).toContain('waiting for coc.nvim MCP server')
    expect(stderr).toContain('connected to coc.nvim')
    pollServer.dispose()
    fs.rmSync(pollDir, { recursive: true, force: true })
  }, 15000)

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
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
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
    let list = await request(2, 'tools/list')
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

  it('enters selection mode and lets the agent pick an instance via coc/connect', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-multi-'))
    let work = path.join(dir, 'shared')
    fs.mkdirSync(work, { recursive: true })
    let { serverA, serverB } = await twoInstances(dir, work, work)
    let proc = spawn(process.execPath, [bridgePath], {
      cwd: work,
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    let init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    expect(init.serverInfo.name).toBe('coc-mcp-bridge')
    let tools = await request(2, 'tools/list')
    let names = tools.tools.map((t: any) => t.name)
    expect(names).toEqual(expect.arrayContaining(['coc/instances', 'coc/connect']))
    let instances = await request(3, 'tools/call', { name: 'coc/instances', arguments: {} })
    expect(instances.structuredContent.count).toBe(2)
    let connect = await request(4, 'tools/call', { name: 'coc/connect', arguments: { pid: process.pid } })
    expect(connect.structuredContent.connected).toBe(true)
    // after connecting, tools/list is relayed to the chosen instance
    let list = await request(5, 'tools/list')
    let relayedNames = list.tools.map((t: any) => t.name)
    expect(relayedNames).toContain('instance_b_tool')
    expect(relayedNames).not.toContain('instance_a_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
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
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await request(2, 'tools/list')
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
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await request(2, 'tools/list')
    let names = list.tools.map((t: any) => t.name)
    expect(names).toContain('instance_b_tool')
    expect(names).not.toContain('instance_a_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    serverA.dispose()
    serverB.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('exits cleanly when the coc.nvim service shuts down', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-bridge-'))
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true })
    let registry = new ToolRegistry()
    registry.register({
      name: 'bridge_exit_tool',
      description: 'exit test',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let exitServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'bridge-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, registry)
    let exitAddress = await exitServer.listen()
    fs.writeFileSync(path.join(dir, 'mcp', `coc-${process.pid}.json`), JSON.stringify({
      version: 1,
      pid: process.pid,
      transport: 'tcp',
      host: '127.0.0.1',
      port: exitAddress.port,
      token: 'bridge-token',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38,
      startedAt: Date.now()
    }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    // simulate coc.nvim exiting: the server closes all sessions
    exitServer.dispose()
    let code = await Promise.race([
      new Promise<number | null>(resolve => proc.on('exit', resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge did not exit after server shutdown')), 5000))
    ])
    expect(code).toBe(0)
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
      startedAt: Date.now()
    }))
    let staleJson = path.join(mcpDir, 'coc-999999999.json')
    let staleSock = path.join(mcpDir, 'coc-999999999.sock')
    fs.writeFileSync(staleJson, '{}')
    fs.writeFileSync(staleSock, '')
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: mcpDir, COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await request(2, 'tools/list')
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
      startedAt: Date.now()
    }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: {
        ...process.env,
        COC_MCP_DIR: path.join(dir, 'mcp'),
        COC_MCP_AUTH_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        COC_MCP_WAIT_MS: '3000'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let { request } = attachClient(proc)
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-test', version: '1' }
    })
    let list = await request(2, 'tools/list')
    expect(list.tools.map((t: any) => t.name)).toContain('key_tool')
    proc.stdin.end()
    await new Promise<void>(resolve => proc.on('exit', () => resolve()))
    keyServer.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('exits with code 3 when the server requires a key but the bridge has none', async () => {
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
      startedAt: Date.now()
    }))
    let proc = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, COC_MCP_DIR: path.join(dir, 'mcp'), COC_MCP_WAIT_MS: '3000' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let code = await Promise.race([
      new Promise<number | null>(resolve => proc.on('exit', resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge did not exit')), 5000))
    ])
    expect(code).toBe(3)
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
      env: { ...process.env, COC_MCP_NO_WAIT: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    let code = await new Promise<number | null>(resolve => proc.on('exit', resolve))
    expect(code).toBe(2)
    expect(stderr).toContain('COC_MCP_AUTH_KEY')
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
        COC_MCP_AUTH_KEY_FILE: keyFile,
        COC_MCP_WAIT_MS: '5000'
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
