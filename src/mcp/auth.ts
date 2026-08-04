'use strict'
import { createLogger } from '../logger'
import { APIVERSION, VERSION } from '../util/constants'
import { crypto, fs, os, path } from '../util/node'
import { isRunning } from '../util/processes'
import { PROTOCOL_VERSION } from './protocol'
const logger = createLogger('mcp-auth')

export interface DiscoveryInfo {
  version: number
  pid: number
  transport: 'tcp' | 'unix'
  host?: string
  port?: number
  socketPath?: string
  token: string
  protocolVersion: string
  serverInfo: { name: string, version: string }
  apiVersion: number
  cwd?: string
  workspaceRoot?: string
  startedAt?: number
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Unified MCP directory (~/.coc/mcp). Independent of COC_DATA_HOME: every
 * coc.nvim instance writes its own `coc-<pid>.json` (and Unix socket) here
 * so multiple editor instances do not overwrite each other, and stale files
 * are cleaned up when a coc.nvim instance starts.
 */
export function getMcpDir(): string {
  return process.env.COC_MCP_DIR || path.join(os.homedir(), '.coc', 'mcp')
}

export function getInstancesDir(mcpDir: string = getMcpDir()): string {
  return mcpDir
}

export function getInstanceFilePath(pid: number, mcpDir: string = getMcpDir()): string {
  return path.join(mcpDir, `coc-${pid}.json`)
}

export function writeInstanceFile(info: DiscoveryInfo, mcpDir: string = getMcpDir()): void {
  let filepath = getInstanceFilePath(info.pid, mcpDir)
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 })
    try {
      fs.chmodSync(filepath, 0o600)
    } catch (_e) {
      // ignore
    }
  } catch (e) {
    logger.error('Failed to write mcp instance file', e)
  }
}

export function removeInstanceFile(pid: number, mcpDir: string = getMcpDir()): void {
  try {
    fs.unlinkSync(getInstanceFilePath(pid, mcpDir))
  } catch (_e) {
    // ignore
  }
}

export function removeSocketFile(socketPath: string): void {
  try {
    fs.unlinkSync(socketPath)
  } catch (_e) {
    // ignore
  }
}

/**
 * List live per-instance discovery files (ignores stale files whose process
 * is no longer running).
 */
export function listInstances(mcpDir: string = getMcpDir()): DiscoveryInfo[] {
  let dir = getInstancesDir(mcpDir)
  let result: DiscoveryInfo[] = []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (_e) {
    return result
  }
  for (let name of names) {
    if (!/^coc-\d+\.json$/.test(name)) continue
    let info = readDiscoveryFile(path.join(dir, name))
    if (!info) continue
    if (typeof info.pid !== 'number' || !isRunning(info.pid)) continue
    result.push(info)
  }
  return result
}

export function readDiscoveryFile(filepath: string): DiscoveryInfo | null {
  let content: string
  try {
    content = fs.readFileSync(filepath, 'utf8')
  } catch (_e) {
    return null
  }
  try {
    let obj = JSON.parse(content) as DiscoveryInfo
    if (!obj || obj.version !== 1) return null
    if (typeof obj.pid !== 'number' || typeof obj.token !== 'string' || obj.token.length === 0) return null
    if (obj.transport !== 'tcp' && obj.transport !== 'unix') return null
    if (obj.transport === 'tcp' && (typeof obj.host !== 'string' || typeof obj.port !== 'number')) return null
    if (obj.transport === 'unix' && typeof obj.socketPath !== 'string') return null
    return obj
  } catch (_e) {
    return null
  }
}

export function createDiscoveryInfo(options: {
  transport: 'tcp' | 'unix'
  host?: string
  port?: number
  socketPath?: string
  token: string
  cwd?: string
  workspaceRoot?: string
}): DiscoveryInfo {
  return {
    version: 1,
    pid: process.pid,
    transport: options.transport,
    host: options.host,
    port: options.port,
    socketPath: options.socketPath,
    token: options.token,
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { name: 'coc.nvim', version: VERSION },
    apiVersion: APIVERSION,
    cwd: options.cwd,
    workspaceRoot: options.workspaceRoot,
    startedAt: Date.now()
  }
}
