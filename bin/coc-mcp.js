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

function log(msg) {
  process.stderr.write('[coc-mcp] ' + msg + '\n')
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
 * Selection mode requested on the command line: 'cwd' (connect to the first
 * instance whose workspace matches the bridge cwd) or 'first' (connect to
 * the first available instance).
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
 * - --match-first connects to the first available instance;
 * - --match-cwd connects to the first instance whose workspace matches the
 *   bridge cwd;
 * - otherwise a single live instance, or a single cwd match, is used;
 *   with several instances and no clear match the bridge enters selection
 *   mode (coc/instances + coc/connect) so the agent can choose.
 */
function decideInstance(mode) {
  const instances = listLiveInstances().sort((a, b) => a.pid - b.pid)
  if (instances.length === 0) {
    return {missing: 'no live coc.nvim instance found in ' + mcpInstancesDir()}
  }
  if (instances.length === 1) return {info: instances[0]}
  if (mode === 'first') return {info: instances[0]}
  const cwd = process.cwd()
  const matches = instances.filter(i => cwdScore(i, cwd) >= 0)
  if (mode === 'cwd') {
    if (matches.length === 0) {
      return {missing: 'no instance matches cwd ' + cwd + ' (--match-cwd)'}
    }
    return {info: matches[0]}
  }
  if (matches.length === 1) return {info: matches[0]}
  return {select: true}
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
  let mode = 'poll' // 'poll' | 'selection' | 'relay' | 'waiting'
  let closed = false
  let socket = null
  let stdinBuffer = Buffer.alloc(0)
  let selectionBuffer = ''
  let selectionQueue = Promise.resolve()
  let agentProtocolVersion = '2025-06-18'
  // 2024-11-05 agents do not know structuredContent (added in 2025-06-18).
  const includeStructured = () => agentProtocolVersion !== '2024-11-05'
  let currentInfo = null
  let relaying = false
  let reconnecting = false
  let instanceWatcher = null

  function writeStdout(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n')
  }

  function fail(code, msg) {
    if (closed) return
    closed = true
    if (msg) log(msg)
    process.exit(code)
  }

  function giveUp(reason) {
    log('startup failed: coc.nvim MCP service not found: ' + reason)
    log('start vim/nvim with coc.nvim and set "mcp.autoStart": true in coc-settings.json, or run :CocCommand mcp.start')
    process.exit(2)
  }

  /**
   * Forward frames between the agent (stdin/stdout) and the connected coc
   * socket. All frames after the handshake are relayed verbatim.
   */
  function startRelay(s, info) {
    socket = s
    mode = 'relay'
    relaying = true
    currentInfo = info
    log('relaying frames between codex and coc.nvim')
    s.on('data', chunk => {
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
      mode = 'waiting'
      // The agent session ends through stdin close (handled elsewhere). A
      // socket close with the agent still connected means coc.nvim went
      // away: wait for the discovery file to be rewritten (coc restart) and
      // reconnect, or exit when the vim process is gone.
      if (!currentInfo || typeof currentInfo.pid !== 'number' || !isPidAlive(currentInfo.pid)) {
        process.exit(0)
      }
      log('coc.nvim MCP server disconnected, waiting for restart...')
      handleInstanceFileEvent(currentInfo.pid)
    })
    if (stdinBuffer.length) {
      s.write(stdinBuffer)
      stdinBuffer = Buffer.alloc(0)
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
    if (closed || reconnecting) return
    const filepath = path.join(mcpInstancesDir(), 'coc-' + pid + '.json')
    if (!fs.existsSync(filepath)) {
      // removed (or not written yet): vim gone means the session is over
      if (!isPidAlive(pid)) process.exit(0)
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
      process.exit(0)
      return
    }
    if (currentInfo && sameEndpoint(currentInfo, info)) return
    reconnectTo(info)
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
    if (closed || relaying || reconnecting) return
    reconnecting = true
    log('coc.nvim MCP server restarted, reconnecting...')
    if (socket) {
      const old = socket
      old.removeAllListeners('close')
      old.destroy()
      socket = null
    }
    connectToInstance(info, true).then(() => {
      reconnecting = false
    }).catch(err => {
      reconnecting = false
      log('reconnect failed: ' + err.message + ', waiting for the next restart')
    })
  }

  /**
   * Connect to a coc.nvim instance, run coc/auth, and for selection mode
   * also run the bridge's own MCP initialize (as the MCP client). Resolves
   * once the handshake is complete and relaying has started.
   */
  function connectToInstance(info, internalInit) {
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
              if (!internalInit) {
                s.removeListener('data', onData)
                startRelay(s, info)
                resolve(s)
                return
              }
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
              startRelay(s, info)
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

  /**
   * Selection mode: the bridge answers the agent's MCP session itself and
   * exposes coc/instances (list) and coc/connect (pick by pid).
   */
  async function handleSelectionFrame(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch (e) {
      writeStdout({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}})
      return
    }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (typeof msg.id !== 'undefined') {
        writeStdout({jsonrpc: '2.0', id: msg.id, error: {code: -32600, message: 'Invalid message'}})
      }
      return
    }
    const isRequest = typeof msg.id !== 'undefined'
    const respond = result => {
      if (isRequest) writeStdout({jsonrpc: '2.0', id: msg.id, result})
    }
    const respondError = (code, message) => {
      if (isRequest) writeStdout({jsonrpc: '2.0', id: msg.id, error: {code, message}})
    }
    switch (msg.method) {
      case 'initialize':
        agentProtocolVersion = (msg.params && msg.params.protocolVersion) || '2025-06-18'
        respond({
          protocolVersion: agentProtocolVersion,
          capabilities: {
            tools: {listChanged: false},
            experimental: {cocInstanceSelection: true}
          },
          serverInfo: {name: 'coc-mcp-bridge', version: '0.0.0'},
          instructions: 'Multiple coc.nvim instances detected. Call coc/instances to list them, then coc/connect with the pid to choose.'
        })
        return
      case 'notifications/initialized':
        return
      case 'ping':
        respond({})
        return
      case 'tools/list':
        respond({
          tools: [
            {
              name: 'coc/instances',
              description: 'List available coc.nvim MCP instances (pid, workspace root, version).',
              inputSchema: {type: 'object', properties: {}}
            },
            {
              name: 'coc/connect',
              description: 'Connect to a coc.nvim instance by pid from coc/instances.',
              inputSchema: {
                type: 'object',
                properties: {pid: {type: 'integer'}},
                required: ['pid']
              }
            }
          ]
        })
        return
      case 'tools/call': {
        const name = msg.params && msg.params.name
        const args = (msg.params && msg.params.arguments) || {}
        if (name === 'coc/instances') {
          const instances = listLiveInstances().sort((a, b) => a.pid - b.pid)
          const list = instances.map(i => ({
            pid: i.pid,
            version: (i.serverInfo && i.serverInfo.version) || 'unknown',
            protocolVersion: i.protocolVersion || 'unknown',
            workspaceRoot: i.workspaceRoot || i.cwd || null,
            transport: i.transport
          }))
          respond({
            content: [{type: 'text', text: JSON.stringify(list, null, 2)}],
            ...(includeStructured() ? {structuredContent: {count: list.length, instances: list}} : {}),
            isError: false
          })
          return
        }
        if (name === 'coc/connect') {
          const pid = args.pid
          if (typeof pid !== 'number') {
            respond({content: [{type: 'text', text: 'pid is required'}], isError: true})
            return
          }
          let file = path.join(mcpInstancesDir(), 'coc-' + pid + '.json')
          let info
          try {
            info = readDiscovery(file)
          } catch (e) {
            respond({content: [{type: 'text', text: 'instance ' + pid + ' not found: ' + e.message}], isError: true})
            return
          }
          try {
            await connectToInstance(info, true)
          } catch (e) {
            respond({content: [{type: 'text', text: 'connect failed: ' + e.message}], isError: true})
            return
          }
          respond({
            content: [{type: 'text', text: 'connected to coc.nvim instance ' + pid}],
            ...(includeStructured() ? {
              structuredContent: {
                connected: true,
                pid,
                serverInfo: info.serverInfo,
                protocolVersion: agentProtocolVersion
              }
            } : {}),
            isError: false
          })
          return
        }
        respondError(-32602, 'Unknown tool: ' + name)
        return
      }
      default:
        respondError(-32601, 'Method not found: ' + msg.method)
    }
  }

  function startSelection() {
    mode = 'selection'
    log('multiple coc.nvim instances, waiting for the agent to choose (coc/instances / coc/connect)')
  }

  function attempt() {
    if (mode !== 'poll' || closed) return
    if (connectInfo) {
      connectToInstance(connectInfo, false).catch(err => {
        if (err && err.code === 3) {
          fail(3, err.message)
          return
        }
        giveUp(err.message)
      })
      return
    }
    let info
    let select = false
    try {
      const selection = decideInstance(matchMode())
      if (selection.missing) {
        giveUp(selection.missing)
        return
      }
      if (selection.select) {
        select = true
      } else {
        info = selection.info
      }
    } catch (e) {
      giveUp(e.message)
      return
    }
    if (select) {
      startSelection()
      return
    }
    connectToInstance(info, false).catch(err => {
      if (err && err.code === 3) {
        fail(3, err.message)
        return
      }
      giveUp(err.message)
    })
  }

  process.stdin.on('data', chunk => {
    if (mode === 'selection') {
      selectionBuffer += chunk.toString('utf8')
      let idx
      while ((idx = selectionBuffer.indexOf('\n')) !== -1) {
        const line = selectionBuffer.slice(0, idx).trim()
        selectionBuffer = selectionBuffer.slice(idx + 1)
        if (line) {
          selectionQueue = selectionQueue.then(() => handleSelectionFrame(line))
        }
      }
      return
    }
    if (mode === 'relay') {
      socket.write(chunk)
      return
    }
    stdinBuffer = Buffer.concat([stdinBuffer, chunk])
  })
  process.stdin.on('error', err => {
    log('stdin error: ' + err.message)
  })
  process.stdin.on('end', () => {
    if (closed) return
    closed = true
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
