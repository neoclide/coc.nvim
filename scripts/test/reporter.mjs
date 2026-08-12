'use strict'

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
}

const SPINNERS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Live per-file progress. A line appears when a test file starts running,
 * with a spinner that rotates every 100ms in place; the line updates to
 * ✓/✗ + duration when the file finishes. Highlighted elapsed time and the
 * completed/total file count stay on the bottom row, with time updated every
 * second. When stdout is piped (CI), state transitions are printed as plain
 * sequential lines.
 */
export function createLiveReporter(files, {stdout = process.stdout, stderr = process.stderr} = {}) {
  const isTTY = Boolean(stdout.isTTY)
  const state = new Map()
  const completed = new Set()
  const totalFiles = new Set(files).size
  const running = []
  const started = performance.now()
  let frame = 0
  let elapsedSeconds = 0
  let spinnerTimer = null
  let elapsedTimer = null
  let drawn = 0
  const writeStdout = stdout.write.bind(stdout)
  const writeStderr = stderr.write.bind(stderr)

  function format(file) {
    const s = state.get(file)
    if (s.status === 'running') return `  ${SPINNERS[frame]} ${file}`
    const mark = s.status === 'passed' ? `${ANSI.green}✓${ANSI.reset}` : `${ANSI.red}✗${ANSI.reset}`
    const duration = s.durationMs > 0 ? `  ${ANSI.yellow}${Math.round(s.durationMs)}ms${ANSI.reset}` : ''
    return `  ${mark} ${file}${duration}`
  }

  function render() {
    if (drawn > 0) writeStdout(`\x1b[${drawn}A`)
    for (const file of running) {
      writeStdout(`\x1b[2K${format(file)}\n`)
    }
    writeStdout(`\x1b[2K${ANSI.bold}${ANSI.cyan}⏱ ${elapsedSeconds}s  ${completed.size}/${totalFiles} files${ANSI.reset}\n`)
    drawn = running.length + 1
    writeStdout('\x1b[J')
  }

  function clearRender() {
    if (drawn === 0) return
    writeStdout(`\x1b[${drawn}A\x1b[J`)
    drawn = 0
  }

  function hasRunning() {
    return running.length > 0
  }

  function writeOutput(message, type = 'stdout') {
    if (!message) return
    const stream = type === 'stderr' ? stderr : stdout
    const write = type === 'stderr' ? writeStderr : writeStdout
    const sharesTerminal = isTTY && Boolean(stream.isTTY)
    if (sharesTerminal) clearRender()
    write(message)
    // Keep a partial process.stdout.write() chunk above the live window as
    // well; otherwise the first progress line would clear that same row.
    if (sharesTerminal && !message.endsWith('\n')) write('\n')
    if (sharesTerminal) render()
  }

  if (isTTY) {
    spinnerTimer = setInterval(() => {
      if (!hasRunning()) return
      frame = (frame + 1) % SPINNERS.length
      render()
    }, 100)
    spinnerTimer.unref?.()
    elapsedTimer = setInterval(() => {
      elapsedSeconds = Math.round((performance.now() - started) / 1000)
      render()
    }, 1000)
    elapsedTimer.unref?.()
  }

  return {
    update(file, next) {
      const current = state.get(file)
      if (current && current.status === next.status && current.durationMs === next.durationMs) return
      state.set(file, next)
      if (next.status === 'running') completed.delete(file)
      else completed.add(file)
      if (isTTY) {
        if (next.status === 'running') {
          if (!running.includes(file)) running.push(file)
          render()
        } else {
          // Like Vitest's WindowRenderer, completed files leave the dynamic
          // window and become permanent output above the still-running files.
          clearRender()
          const index = running.indexOf(file)
          if (index !== -1) running.splice(index, 1)
          writeStdout(`${format(file)}\n`)
          render()
        }
      } else {
        const mark = next.status === 'passed' ? '✓' : next.status === 'failed' ? '✗' : '▶'
        const duration = next.durationMs > 0 ? `  ${Math.round(next.durationMs)}ms` : ''
        writeStdout(`${mark} ${file}${duration}\n`)
      }
    },
    output(message, type = 'stdout') {
      writeOutput(message, type)
    },
    error(message) {
      const text = message.endsWith('\n') ? message : `${message}\n`
      writeOutput(text, 'stderr')
    },
    finish() {
      if (spinnerTimer) clearInterval(spinnerTimer)
      if (elapsedTimer) clearInterval(elapsedTimer)
      if (isTTY) {
        clearRender()
        const pending = running.splice(0)
        for (const file of pending) writeStdout(`${format(file)}\n`)
        if (pending.length > 0) writeStdout('\n')
      }
    },
  }
}
