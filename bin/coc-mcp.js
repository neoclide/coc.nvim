#!/usr/bin/env node
'use strict'

/**
 * coc-mcp: stdio MCP server bridge for Codex (and other MCP clients).
 *
 * Codex launches this process over stdio; it connects back to the coc.nvim
 * MCP socket server (see .codex/mcp.md) and relays JSON-RPC frames between
 * stdin/stdout and the socket. The framing is identical on both sides
 * (one JSON-RPC message per newline-delimited line).
 */

const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const POLL_INTERVAL_MS = Number(process.env.COC_MCP_POLL_INTERVAL_MS) || 5000
const STARTUP_TIMEOUT_MS = Number(process.env.COC_MCP_STARTUP_TIMEOUT_MS) || 5000
const AGENT_LOG_FILE = path.join(os.homedir(), '.log', `mcp-${process.pid}.log`)

function log(msg) {
  process.stderr.write('[coc-mcp] ' + msg + '\n')
}

let agentLogErrorReported = false

function logAgentMessage(direction, message) {
  try {
    fs.mkdirSync(path.dirname(AGENT_LOG_FILE), {recursive: true})
    fs.appendFileSync(
      AGENT_LOG_FILE,
      `[${new Date().toISOString()}] ${direction} ${message}\n`
    )
  } catch (e) {
    if (!agentLogErrorReported) {
      agentLogErrorReported = true
      log('unable to write agent message log: ' + e.message)
    }
  }
}

function logAgentChunk(direction, chunk, state) {
  state.buffer += chunk.toString('utf8')
  let index
  while ((index = state.buffer.indexOf('\n')) !== -1) {
    let line = state.buffer.slice(0, index)
    state.buffer = state.buffer.slice(index + 1)
    if (line.trim()) logAgentMessage(direction, line)
  }
}

/**
 * Unified MCP instances directory, independent of COC_DATA_HOME. Every
 * coc.nvim instance writes coc-<pid>.json (and its unix socket) here; stale
 * files are cleaned up by coc.nvim on startup. COC_MCP_DIR is an optional
 * override for special setups (e.g. tests, remote mounts).
 */
function mcpInstancesDir() {
  return process.env.COC_MCP_DIR || path.join(os.homedir(), '.coc', 'mcp')
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e && e.code === 'EPERM'
  }
}

function listLiveInstancesInDir(dir) {
  let result = []
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    return result
  }
  for (let name of names) {
    const m = /^coc-(\d+)\.json$/.exec(name)
    if (!m) continue
    const pid = Number(m[1])
    if (!isPidAlive(pid)) continue
    let info
    try {
      info = readDiscovery(path.join(dir, name))
    } catch (e) {
      continue
    }
    if (info) result.push(info)
  }
  return result
}

/**
 * Remove stale instance files (coc-<pid>.json / coc-<pid>.sock) whose
 * process is no longer running. The bridge does this on every scan, so the
 * directory stays tidy without coc.nvim having to clean it up.
 */
function cleanStaleFiles(dir) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    return
  }
  for (const name of names) {
    const m = /^coc-(\d+)\.(json|sock)$/.exec(name)
    if (!m) continue
    const pid = Number(m[1])
    if (!isPidAlive(pid)) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch (e) {
        // ignore
      }
    }
  }
}

function listLiveInstances() {
  const dir = mcpInstancesDir()
  cleanStaleFiles(dir)
  return listLiveInstancesInDir(dir)
}

/**
 * Depth of cwd inside an instance's workspace (0 = equal, >0 = nested,
 * -1 = not inside).
 */
function cwdScore(info, cwd) {
  let base = info.workspaceRoot || info.cwd
  if (!base) return -1
  // normalize symlinks (e.g. /tmp -> /private/tmp on macOS)
  try {
    base = fs.realpathSync(base)
  } catch (e) {
    // keep the raw path
  }
  let cur = cwd
  try {
    cur = fs.realpathSync(cur)
  } catch (e) {
    // keep the raw path
  }
  const rel = path.relative(base, cur)
  if (rel === '') return 0
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return -1
  return rel.split(path.sep).length
}

/**
 * Instance selection requested on the command line: 'cwd' (connect to the
 * first instance whose workspace matches the bridge cwd) or 'first'
 * (connect to the first available instance). Returns null when no flag is
 * given, in which case the caller falls back to 'cwd'.
 */
function matchMode() {
  let mode = null
  for (const arg of process.argv.slice(2)) {
    if (arg === '--match-cwd' || arg === '--match-first') {
      if (mode && mode !== arg.slice(8)) {
        throw new Error('--match-cwd and --match-first are mutually exclusive')
      }
      mode = arg.slice(8)
    }
  }
  return mode
}

/**
 * Direct connect endpoint from `--connect host:port` (or bare `--connect
 * port`, defaulting to 127.0.0.1). Used with SSH-forwarded loopback ports:
 * no discovery file is read, so the token-bearing coc-<pid>.json never
 * needs to leave the remote host. Public-key auth is mandatory in this
 * mode (COC_MCP_AUTH_KEY_FILE).
 */
function parseConnectEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('--connect requires host:port or port')
  }
  let host = '127.0.0.1'
  let portStr = value
  if (value.startsWith('[')) {
    // [::1]:port
    const end = value.indexOf(']')
    if (end === -1) throw new Error('invalid --connect address: ' + value)
    host = value.slice(1, end)
    portStr = value.slice(end + 2)
  } else {
    const idx = value.lastIndexOf(':')
    if (idx !== -1) {
      host = value.slice(0, idx)
      portStr = value.slice(idx + 1)
    }
  }
  if (host === '') throw new Error('invalid --connect host in ' + value)
  const port = parseInt(portStr, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('invalid --connect port: ' + portStr)
  }
  return {host, port}
}

function connectEndpoint() {
  let value = null
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--connect') {
      if (value !== null) throw new Error('--connect specified twice')
      value = args[i + 1]
      i++
    } else if (arg.startsWith('--connect=')) {
      if (value !== null) throw new Error('--connect specified twice')
      value = arg.slice('--connect='.length)
    }
  }
  if (value === null) return null
  return parseConnectEndpoint(value)
}

/**
 * The bridge private key PEM from COC_MCP_AUTH_KEY_FILE (a path to a PEM
 * file, easier to configure in ~/.codex/config.toml than multi-line env).
 */
function resolveAuthKey() {
  const file = process.env.COC_MCP_AUTH_KEY_FILE
  if (typeof file === 'string' && file.length > 0) {
    return fs.readFileSync(file, 'utf8')
  }
  return undefined
}

/**
 * Decide which coc.nvim instance to connect to:
 * - 'cwd' (the default) connects to the first instance whose workspace
 *   contains the bridge cwd and fails when no instance matches;
 * - 'first' connects to the first available instance, ignoring cwd.
 */
function decideInstance(mode) {
  const instances = listLiveInstances().sort((a, b) => a.pid - b.pid)
  if (instances.length === 0) {
    return {missing: 'no live coc.nvim instance found in ' + mcpInstancesDir()}
  }
  if (mode === 'first') return {info: instances[0]}
  const cwd = process.cwd()
  const matches = instances.filter(i => cwdScore(i, cwd) >= 0)
  if (matches.length === 0) {
    return {missing: 'no instance matches cwd ' + cwd + ' (default --match-cwd)'}
  }
  return {info: matches[0]}
}

function readDiscovery(file) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (e) {
    throw new Error('cannot read discovery file ' + file + ': ' + e.message)
  }
  let info
  try {
    info = JSON.parse(content)
  } catch (e) {
    throw new Error('invalid discovery file ' + file)
  }
  if (!info || info.version !== 1 || typeof info.token !== 'string' || info.token.length === 0) {
    throw new Error('invalid discovery file ' + file)
  }
  if (info.transport === 'unix') {
    if (typeof info.socketPath !== 'string') throw new Error('invalid socketPath in discovery file')
  } else if (info.transport === 'tcp') {
    if (typeof info.port !== 'number' || typeof info.host !== 'string') throw new Error('invalid port/host in discovery file')
  } else {
    throw new Error('unsupported transport ' + info.transport)
  }
  return info
}

function main() {
  if (process.argv.includes('--generate-key')) {
    const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'})
    console.log('PRIVATE KEY (write to a PEM file and set COC_MCP_AUTH_KEY_FILE for the bridge, keep secret):')
    console.log(privateKey.export({type: 'pkcs8', format: 'pem'}).toString())
    console.log('PUBLIC KEY (set as mcp.authClientPublicKey in coc-settings.json):')
    console.log(publicKey.export({type: 'spki', format: 'pem'}).toString())
    process.exit(0)
  }
  let connectInfo = null
  try {
    const endpoint = connectEndpoint()
    if (endpoint) {
      if (matchMode()) {
        throw new Error('--connect cannot be combined with --match-cwd/--match-first')
      }
      if (!resolveAuthKey()) {
        log('--connect requires public-key auth: set COC_MCP_AUTH_KEY_FILE to the private key PEM file')
        log('generate a keypair with `node bin/coc-mcp.js --generate-key` and set the public key as mcp.authClientPublicKey on the remote coc.nvim')
        process.exit(2)
      }
      connectInfo = {
        transport: 'tcp',
        host: endpoint.host,
        port: endpoint.port,
        token: '',
        serverInfo: {version: 'unknown'},
        protocolVersion: 'unknown'
      }
      log('connecting directly to ' + endpoint.host + ':' + endpoint.port + ' (--connect, public-key auth)')
    }
  } catch (e) {
    log(e.message)
    process.exit(2)
  }
  let mode = 'poll' // 'poll' | 'relay'
  let closed = false
  let socket = null
  let pendingFrames = []
  let stdinBuffer = ''
  let agentInputState = {buffer: ''}
  let agentOutputState = {buffer: ''}
  let agentProtocolVersion = '2025-06-18'
  let currentInfo = null
  let relaying = false
  let reconnecting = false
  let instanceWatcher = null
  let pollTimer = null
  let startupTimer = null
  let connecting = false
  let clientInitialized = false
  let connectionNotified = false
  let pendingInitialize = null
  let backendInitializeResult = null
  let lastConnectionError = 'coc.nvim MCP service not found'

  function writeStdout(msg) {
    let frame = JSON.stringify(msg) + '\n'
    // logAgentMessage('SEND', frame.trimEnd())
    process.stdout.write(frame)
  }

  function retryDelay() {
    return pendingInitialize ? Math.min(POLL_INTERVAL_MS, 100) : POLL_INTERVAL_MS
  }

  function scheduleAttempt() {
    if (closed || mode === 'relay' || connecting || pollTimer) return
    const delay = retryDelay()
    pollTimer = setTimeout(() => {
      pollTimer = null
      attempt()
    }, delay)
  }

  function sendInitializeResult(msg) {
    const requested = msg.params && msg.params.protocolVersion
    if (typeof requested === 'string') agentProtocolVersion = requested
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    pendingInitialize = null
    clientInitialized = true
    const result = Object.assign({}, backendInitializeResult || {})
    result.protocolVersion = result.protocolVersion || agentProtocolVersion
    result.capabilities = result.capabilities || {}
    result.serverInfo = result.serverInfo || (currentInfo && currentInfo.serverInfo) || {name: 'coc-mcp-bridge', version: '0.0.0'}
    writeStdout({
      jsonrpc: '2.0',
      id: msg.id,
      result
    })
  }

  function failStartup() {
    if (closed || clientInitialized || !pendingInitialize) return
    const msg = pendingInitialize
    pendingInitialize = null
    startupTimer = null
    const message = `coc.nvim MCP service unavailable after ${STARTUP_TIMEOUT_MS}ms: ${lastConnectionError}`
    log(message)
    writeStdout({jsonrpc: '2.0', id: msg.id, error: {code: -32000, message}})
    closed = true
    if (pollTimer) clearTimeout(pollTimer)
    if (instanceWatcher) instanceWatcher.close()
    if (socket) socket.destroy()
    setImmediate(() => process.exit(2))
  }

  function waitForInitialize(msg) {
    const requested = msg.params && msg.params.protocolVersion
    if (typeof requested === 'string') agentProtocolVersion = requested
    if (mode === 'relay' && socket && backendInitializeResult) {
      sendInitializeResult(msg)
      return
    }
    if (pendingInitialize) {
      writeStdout({jsonrpc: '2.0', id: msg.id, error: {code: -32600, message: 'Initialize already pending'}})
      return
    }
    pendingInitialize = msg
    startupTimer = setTimeout(failStartup, STARTUP_TIMEOUT_MS)
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (!connecting) attempt()
  }

  function handleWaitingFrame(line, msg) {
    if (msg && msg.method === 'initialize' && msg.id !== undefined) {
      waitForInitialize(msg)
      return
    }
    if (msg && msg.method === 'notifications/initialized') return
    if (mode === 'relay' && socket) {
      socket.write(line + '\n')
      return
    }
    pendingFrames.push(line + '\n')
  }

  function notifyConnected(info) {
    if (connectionNotified || !clientInitialized) return
    connectionNotified = true
    const version = info && info.serverInfo && info.serverInfo.version || 'unknown'
    writeStdout({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'info',
        logger: 'coc-mcp-bridge',
        data: 'Connected to coc.nvim ' + version
      }
    })
    writeStdout({jsonrpc: '2.0', method: 'notifications/tools/list_changed'})
  }

  /**
   * Forward frames between the agent (stdin/stdout) and the connected coc
   * socket. All frames after the handshake are relayed verbatim.
   */
  function startRelay(s, info, initializeResult) {
    const wasInitialized = clientInitialized
    socket = s
    mode = 'relay'
    relaying = true
    connecting = false
    currentInfo = info
    backendInitializeResult = initializeResult
    connectionNotified = false
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    log('relaying frames between codex and coc.nvim')
    s.on('data', chunk => {
      // logAgentChunk('SEND', chunk, agentOutputState)
      process.stdout.write(chunk)
    })
    s.on('error', err => {
      log('connection error: ' + err.message)
    })
    s.on('close', () => {
      if (closed) {
        // the agent ended the session: exit once the socket is gone
        process.exit(0)
        return
      }
      if (!relaying) return
      relaying = false
      mode = 'poll'
      connecting = false
      backendInitializeResult = null
      log('coc.nvim MCP server disconnected, polling for a new connection...')
      scheduleAttempt()
    })
    if (pendingInitialize) sendInitializeResult(pendingInitialize)
    if (wasInitialized) notifyConnected(info)
    if (pendingFrames.length) {
      for (const frame of pendingFrames) s.write(frame)
      pendingFrames = []
    }
    watchInstanceFile(info)
  }

  /**
   * Watch the connected instance's discovery file. coc.nvim keys it by the
   * vim pid, so a restart rewrites the same file; the bridge reconnects to
   * the new endpoint/token instead of exiting.
   */
  function watchInstanceFile(info) {
    if (instanceWatcher) {
      instanceWatcher.close()
      instanceWatcher = null
    }
    if (!info || typeof info.pid !== 'number') return
    const name = 'coc-' + info.pid + '.json'
    try {
      instanceWatcher = fs.watch(mcpInstancesDir(), (_event, filename) => {
        if (filename !== name) return
        handleInstanceFileEvent(info.pid)
      })
    } catch (e) {
      // directory watching unavailable: no reconnect support
    }
  }

  function handleInstanceFileEvent(pid) {
    if (closed) return
    const filepath = path.join(mcpInstancesDir(), 'coc-' + pid + '.json')
    if (!fs.existsSync(filepath)) {
      if (!isPidAlive(pid)) scheduleAttempt()
      return
    }
    let info
    try {
      info = readDiscovery(filepath)
    } catch (e) {
      // mid-write: retry shortly
      setTimeout(() => handleInstanceFileEvent(pid), 200)
      return
    }
    if (!isPidAlive(info.pid)) {
      scheduleAttempt()
      return
    }
    if (currentInfo && sameEndpoint(currentInfo, info)) return
    if (relaying) reconnectTo(info)
    else attempt()
  }

  function sameEndpoint(a, b) {
    if (a.transport !== b.transport || a.token !== b.token) return false
    if (a.transport === 'unix') return a.socketPath === b.socketPath
    return a.host === b.host && a.port === b.port
  }

  /**
   * Reconnect to a restarted coc.nvim MCP server: close the old socket and
   * run the handshake (auth + the bridge's own initialize) against the new
   * endpoint, then resume relaying.
   */
  function reconnectTo(info) {
    if (closed || !relaying || reconnecting) return
    reconnecting = true
    relaying = false
    mode = 'poll'
    connecting = true
    log('coc.nvim MCP server restarted, reconnecting...')
    if (socket) {
      const old = socket
      old.removeAllListeners('close')
      old.destroy()
      socket = null
    }
    connectToInstance(info).then(() => {
      reconnecting = false
    }).catch(err => {
      reconnecting = false
      connecting = false
      log('reconnect failed: ' + err.message + ', polling for another connection')
      scheduleAttempt()
    })
  }

  /**
   * Connect to a coc.nvim instance and run coc/auth and the bridge's own MCP
   * initialize (as the MCP client). Resolves once the handshake is complete
   * and relaying has started.
   */
  function connectToInstance(info) {
    return new Promise((resolve, reject) => {
      const s = info.transport === 'unix'
        ? net.createConnection(info.socketPath)
        : net.createConnection({host: info.host, port: info.port})
      s.setNoDelay(true)
      let settled = false
      const failOnce = err => {
        if (settled) return
        settled = true
        s.destroy()
        reject(err)
      }
      s.on('error', failOnce)
      s.on('connect', () => {
        if (settled) {
          s.destroy()
          return
        }
        const server = info.serverInfo || {}
        log('connected to coc.nvim ' + (server.version || 'unknown') +
          ' (mcp protocol ' + (info.protocolVersion || 'unknown') + ', transport ' + info.transport + ')')
        const authKey = resolveAuthKey()
        const sendAuth = extra => {
          const params = {
            token: info.token,
            clientInfo: {
              name: 'coc-mcp-bridge',
              version: (info.serverInfo && info.serverInfo.version) || '0.0.0',
              pid: process.pid
            }
          }
          if (extra) Object.assign(params, extra)
          s.write(JSON.stringify({jsonrpc: '2.0', id: 0, method: 'coc/auth', params}) + '\n')
        }
        let buffer = ''
        const onData = chunk => {
          buffer += chunk.toString('utf8')
          let idx
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim()
            buffer = buffer.slice(idx + 1)
            if (!line) continue
            let msg
            try {
              msg = JSON.parse(line)
            } catch (e) {
              continue
            }
            if (msg.id === 2 && msg.result && typeof msg.result.nonce === 'string') {
              // optional public-key auth: sign the server-issued nonce
              let signature
              try {
                signature = crypto.sign('sha256', Buffer.from(msg.result.nonce), authKey).toString('base64')
              } catch (e) {
                failOnce(new Error('signing failed: ' + e.message))
                return
              }
              sendAuth({nonce: msg.result.nonce, signature})
              continue
            }
            if (msg.id === 0) {
              if (msg.error || !msg.result || !msg.result.ok) {
                const err = new Error('authentication failed: ' + ((msg.error && msg.error.message) || 'unknown error'))
                err.code = 3
                failOnce(err)
                return
              }
              const caps = msg.result.capabilities || {}
              log('server capabilities: ' + (Object.keys(caps).join(', ') || '(none)'))
              s.write(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                  protocolVersion: agentProtocolVersion,
                  capabilities: {},
                  clientInfo: {name: 'coc-mcp-bridge', version: '0.0.0', pid: process.pid}
                }
              }) + '\n')
              s.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n')
              return
            }
            if (msg.id === 1) {
              if (msg.error) {
                failOnce(new Error('coc.nvim initialize failed: ' + (msg.error.message || 'unknown error')))
                return
              }
              s.removeListener('data', onData)
              startRelay(s, info, msg.result)
              resolve(s)
              return
            }
            // other frames during the handshake are ignored
          }
        }
        if (authKey) {
          s.write(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'coc/challenge'}) + '\n')
        } else {
          sendAuth()
        }
        s.on('data', onData)
      })
    })
  }

  function attempt() {
    if (mode !== 'poll' || closed || connecting) return
    connecting = true
    if (connectInfo) {
      connectToInstance(connectInfo).catch(err => {
        connecting = false
        lastConnectionError = err.message
        log('connection failed: ' + err.message + '; retrying in ' + (retryDelay() / 1000) + 's')
        scheduleAttempt()
      })
      return
    }
    let info
    try {
      const decision = decideInstance(matchMode() || 'cwd')
      if (decision.missing) {
        connecting = false
        lastConnectionError = decision.missing
        log('coc.nvim MCP service not found: ' + decision.missing + '; retrying in ' + (retryDelay() / 1000) + 's')
        scheduleAttempt()
        return
      }
      info = decision.info
    } catch (e) {
      connecting = false
      lastConnectionError = e.message
      log('connection scan failed: ' + e.message + '; retrying in ' + (retryDelay() / 1000) + 's')
      scheduleAttempt()
      return
    }
    connectToInstance(info).catch(err => {
      connecting = false
      lastConnectionError = err.message
      log('connection failed: ' + err.message + '; retrying in ' + (retryDelay() / 1000) + 's')
      scheduleAttempt()
    })
  }

  process.stdin.on('data', chunk => {
    if (mode === 'relay' && clientInitialized && socket) {
      // logAgentChunk('RECV', chunk, agentInputState)
      socket.write(chunk)
      return
    }
    let input = stdinBuffer + chunk.toString('utf8')
    stdinBuffer = ''
    let lines = input.split('\n')
    if (lines[lines.length - 1] !== '') {
      stdinBuffer = lines.pop()
    }
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // logAgentMessage('RECV', trimmed)
      try {
        handleWaitingFrame(trimmed, JSON.parse(trimmed))
      } catch (e) {
        pendingFrames.push(line + '\n')
      }
    }
  })
  process.stdin.on('error', err => {
    log('stdin error: ' + err.message)
  })
  process.stdin.on('end', () => {
    if (closed) return
    closed = true
    if (pollTimer) clearTimeout(pollTimer)
    if (startupTimer) clearTimeout(startupTimer)
    if (instanceWatcher) instanceWatcher.close()
    if (mode === 'relay' && socket) {
      socket.end()
    } else {
      process.exit(0)
    }
  })
  process.stdin.resume()

  attempt()
}

main()
