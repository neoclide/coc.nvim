'use strict'
import { createLogger } from '../logger'
import { Disposable } from '../util/protocol'
import events from '../events'
import { fs, path } from '../util/node'
import workspace from '../workspace'
import {
  createDiscoveryInfo,
  generateToken,
  getMcpDir,
  removeInstanceFile,
  removeSocketFile,
  writeInstanceFile
} from './auth'
import { NotificationManager } from './notifications'
import { ResourceManager } from './resources'
import { McpServer } from './server'
import { McpTool, ToolRegistry } from './tools'
import { createDocumentTools } from './tools/document'
import { createEditorTools } from './tools/editor'
import { createLspTools } from './tools/lsp'
import { createWorkspaceTools } from './tools/workspace'
const logger = createLogger('mcp')

export interface McpConfig {
  autoStart: boolean
  host: string
  port: number
  transport: 'tcp' | 'unix'
  authRequired: boolean
  maxClients: number
  frameMaxBytes: number
  timeout: number
  idleTimeout: number
  maxRequestsPerSecond: number
  authClientPublicKey: string
  readTimeout: number
  allowedTools: string[]
}

class McpService implements Disposable {
  private server: McpServer | undefined
  private startPromise: Promise<void> | undefined
  private generation = 0
  private notifications: NotificationManager | undefined
  private token = ''
  private registry: ToolRegistry | undefined
  private socketPath: string | undefined
  private vimLeaveDisposable: Disposable | undefined
  private pid = 0

  public get running(): boolean {
    return this.server != null
  }

  public status(): any {
    if (!this.server) return { running: false }
    let cwd = ''
    try {
      cwd = workspace.cwd || process.cwd()
    } catch (_e) {
      cwd = process.cwd()
    }
    return { pid: process.pid, cwd, ...this.server.status() }
  }

  /**
   * Human-readable status lines shared by `:CocCommand mcp.status` and
   * `:CocInfo`.
   */
  public getStatusLines(): string[] {
    let status = this.status()
    if (!status.running) {
      return ['MCP server: not running']
    }
    let address = status.transport === 'unix'
      ? String(status.socketPath)
      : `${status.host}:${status.port}`
    let lines = [
      'MCP server: running',
      `  transport: ${status.transport}`,
      `  address: ${address}`,
      `  pid: ${status.pid}`,
      `  cwd: ${status.cwd}`,
      `  clients: ${status.clients.length}`,
      ...status.clients.map((c: any) => {
        let connected = new Date(c.connectedAt).toLocaleTimeString()
        let last = new Date(c.lastActiveAt).toLocaleTimeString()
        return `    #${c.id} ${c.name || 'client'} pid ${c.pid ?? '-'} connected ${connected} last ${last}`
      }),
      `  tools: ${status.tools.length}`,
      ...status.tools.map((t: string) => `    ${t}`),
      `  protocol: ${status.protocolVersion}`
    ]
    return lines
  }

  /**
   * Start the MCP socket server. No-op when mcp.autoStart is false, unless
   * force is true (`:CocCommand mcp.start` starts the server regardless).
   * Concurrent calls share a single start flow; a stop() while starting
   * invalidates the pending start so its server and discovery artifacts are
   * never published.
   */
  public start(force = false): Promise<void> {
    if (this.server) return Promise.resolve()
    if (this.startPromise) return this.startPromise
    let promise = this.doStart(force)
    this.startPromise = promise
    void promise.then(() => {
      if (this.startPromise === promise) this.startPromise = undefined
    }, () => {
      if (this.startPromise === promise) this.startPromise = undefined
    })
    return promise
  }

  private async doStart(force: boolean): Promise<void> {
    let config = this.getConfig()
    if (!force && !config.autoStart) {
      logger.info('MCP server disabled by configuration')
      return
    }
    let generation = this.generation
    let pid = this.pid = workspace.env ? workspace.env.pid : process.pid
    let token = generateToken()
    let socketPath = config.transport === 'unix'
      ? path.join(getMcpDir(), `coc-${process.pid}.sock`)
      : undefined
    fs.mkdirSync(getMcpDir(), { recursive: true })
    let registry = this.getRegistry()
    registry.setAllowedTools(config.allowedTools)
    let server = new McpServer({
      transport: config.transport,
      host: config.host,
      port: config.port,
      socketPath,
      token,
      authRequired: config.authRequired,
      maxClients: config.maxClients,
      frameMaxBytes: config.frameMaxBytes,
      timeout: config.timeout,
      idleTimeout: config.idleTimeout,
      maxRequestsPerSecond: config.maxRequestsPerSecond,
      authClientPublicKey: config.authClientPublicKey,
      readTimeout: config.readTimeout
    }, registry, new ResourceManager())
    try {
      let address = await server.listen()
      // A stop() (or any newer lifecycle generation) invalidates this start:
      // the server must be disposed and nothing may be published.
      if (generation !== this.generation) {
        server.dispose()
        return
      }
      this.server = server
      this.notifications = new NotificationManager(server)
      // Vim 8 kills the node process with SIGKILL right after VimLeavePre,
      // so the MCP service (instance/socket files) must be closed here.
      this.vimLeaveDisposable = events.on('VimLeavePre', () => {
        this.stop()
      })
      this.token = token
      this.socketPath = socketPath
      let cwd = ''
      let root = ''
      try {
        cwd = workspace.cwd || process.cwd()
        root = workspace.root || cwd
      } catch (_e) {
        cwd = process.cwd()
        root = cwd
      }
      writeInstanceFile(createDiscoveryInfo({
        transport: config.transport,
        host: address.host,
        port: address.port,
        socketPath: address.socketPath || socketPath,
        token,
        pid,
        cwd,
        workspaceRoot: root
      }))
      if (workspace.nvim) {
        workspace.nvim.setVar('coc_mcp_started', 1, true)
      }
      let location = config.transport === 'unix' ? address.socketPath : `${address.host}:${address.port}`
      logger.info(`MCP server listening on ${location}, tools: ${server.tools.list().tools.length}`)
    } catch (e) {
      server.dispose()
      logger.error('Failed to start MCP server', e)
    }
  }

  /**
   * Called once at plugin init: start the server when mcp.autoStart is set,
   * or when it was running before a coc.nvim restart (`:CocRestart`), whose
   * started state is kept in a vim variable.
   */
  public async init(started = false): Promise<void> {
    if (started) {
      await this.start(true)
    } else {
      await this.start()
    }
  }

  /**
   * Stop the MCP socket server and remove the discovery file.
   */
  public stop(): void {
    // Invalidate every in-flight start so its server is disposed before any
    // discovery file, token or vim state is published.
    this.generation++
    let server = this.server
    this.server = undefined
    if (server) server.dispose()
    if (this.notifications) {
      this.notifications.dispose()
      this.notifications = undefined
    }
    if (this.vimLeaveDisposable) {
      let disposable = this.vimLeaveDisposable
      this.vimLeaveDisposable = undefined
      disposable.dispose()
    }
    this.token = ''
    if (this.socketPath) {
      removeSocketFile(this.socketPath)
      this.socketPath = undefined
    }
    removeInstanceFile(process.pid)
    if (this.pid && this.pid !== process.pid) {
      removeInstanceFile(this.pid)
    }
    this.pid = 0
    if (workspace.nvim) {
      workspace.nvim.setVar('coc_mcp_started', 0, true)
    }
    logger.info('MCP server stopped')
  }

  public dispose(): void {
    this.stop()
  }

  /**
   * Register a custom MCP tool from a coc.nvim extension. The tool becomes
   * available on the next `tools/list` (immediately when the server is
   * running, via `notifications/tools/list_changed`). Returns a Disposable
   * that unregisters the tool.
   */
  public registerTool(tool: McpTool): Disposable {
    let name = tool?.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('Tool name is required')
    }
    return this.getRegistry().register(tool)
  }

  private getRegistry(): ToolRegistry {
    if (!this.registry) {
      let registry = new ToolRegistry()
      for (let tool of [...createWorkspaceTools(), ...createDocumentTools(), ...createLspTools(), ...createEditorTools()]) {
        registry.register(tool)
      }
      this.registry = registry
    }
    return this.registry
  }

  private getConfig(): McpConfig {
    let config = workspace.getConfiguration('mcp')
    return {
      autoStart: config.get<boolean>('autoStart', false),
      host: config.get<string>('host', '127.0.0.1'),
      port: config.get<number>('port', 0),
      transport: resolveTransport(config.get<string>('transport', 'auto')),
      authRequired: config.get<boolean>('authRequired', true),
      maxClients: config.get<number>('maxClients', 4),
      frameMaxBytes: config.get<number>('frameMaxBytes', 16 * 1024 * 1024),
      timeout: config.get<number>('timeout', 5000),
      idleTimeout: config.get<number>('idleTimeout', 0),
      maxRequestsPerSecond: config.get<number>('maxRequestsPerSecond', 60),
      authClientPublicKey: config.get<string>('authClientPublicKey', ''),
      readTimeout: config.get<number>('readTimeout', 15000),
      // Only tools listed in mcp.allowedTools are exposed to agents
      // (default: none). Built-in tools:
      // document/read, document/read_lines, document/apply_edits,
      // document/write, document/format, document/open,
      // workspace/info, workspace/configuration, workspace/search,
      // workspace/files, workspace/apply_edit, workspace/create_file,
      // workspace/rename_file, workspace/delete_file,
      // lsp/hover, lsp/signature_help, lsp/definition, lsp/declaration,
      // lsp/type_definition, lsp/implementation, lsp/references,
      // lsp/document_symbols, lsp/workspace_symbols, lsp/diagnostics,
      // lsp/code_actions, lsp/apply_code_action, lsp/rename,
      // lsp/execute_command, lsp/request, lsp/capabilities, lsp/batch.
      allowedTools: config.get<string[]>('allowedTools', [])
    }
  }
}

/**
 * 'auto' prefers a Unix domain socket on macOS/Linux (no exposed TCP port)
 * and falls back to loopback TCP on Windows.
 */
function resolveTransport(transport: string): 'tcp' | 'unix' {
  if (transport === 'unix') return 'unix'
  if (transport === 'auto') return process.platform === 'win32' ? 'tcp' : 'unix'
  return 'tcp'
}

export default new McpService()
