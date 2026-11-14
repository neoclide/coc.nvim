import type { ChildProcess, ExecFileOptions } from 'child_process'
import { once } from 'events'
import { CancellationError } from '../../util/errors'
import { child_process, promisify } from '../../util/node'
import { execWithTimeout, needsShell, quoteShellArg } from '../../util/processes'
import { CancellationToken, CancellationTokenSource } from '../../util/protocol'

describe('execWithTimeout', () => {
  it('returns stdout and stderr', async () => {
    let result = await execWithTimeout(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err")'])
    assert.deepStrictEqual(result, { stdout: 'out', stderr: 'err' })
  })

  it('preserves process errors and stderr', async () => {
    await assert.rejects(execWithTimeout(process.execPath, ['-e', 'process.stderr.write("failed"); process.exit(2)']), {
      code: 2,
      stderr: 'failed'
    })
    await assert.rejects(execWithTimeout('coc-nonexistent-executable', []), { code: 'ENOENT' })
  })

  it('does not start a process for an already cancelled token', async t => {
    let exec = t.mock.method(child_process, 'execFile', () => {
      throw new Error('unexpected execFile call')
    })
    await assert.rejects(execWithTimeout(process.execPath, [], {}, CancellationToken.Cancelled), CancellationError)
    assert.strictEqual(exec.mock.callCount(), 0)
  })

  for (let cancel of [false, true]) {
    it(`kills a hanging process on ${cancel ? 'cancellation' : 'timeout'}`, async t => {
      let exec = promisify(child_process.execFile)
      let child: ChildProcess
      let closed: Promise<void>
      let fakeExecFile = Object.assign(() => {}, {
        [promisify.custom]: (file: string, args: string[], opts: ExecFileOptions) => {
          let pending = exec(file, args, opts)
          child = pending.child
          closed = new Promise(resolve => child.once('close', () => resolve()))
          return pending
        }
      })
      t.mock.property(child_process, 'execFile', fakeExecFile as unknown as typeof child_process.execFile)
      let source = new CancellationTokenSource()
      let pending = execWithTimeout(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.stdout.write("ready")'], {}, cancel ? source.token : 1000)
      let rejected = assert.rejects(pending, CancellationError)
      try {
        await once(child.stdout, 'data')
        if (cancel) source.cancel()
        await rejected
        await closed
        assert.strictEqual(child.killed, true)
        if (process.platform !== 'win32') assert.strictEqual(child.signalCode, 'SIGKILL')
      } finally {
        child.kill('SIGKILL')
        source.dispose()
        await closed
      }
    })
  }

  it('cleans up the cancellation listener after completion', async t => {
    let dispose = t.mock.fn()
    let token: CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose })
    }
    await execWithTimeout(process.execPath, ['-e', ''], {}, token)
    assert.strictEqual(dispose.mock.callCount(), 1)
    await assert.rejects(execWithTimeout(process.execPath, ['-e', 'process.exit(1)'], {}, token))
    assert.strictEqual(dispose.mock.callCount(), 2)
  })
})

describe('windows shell spawn', () => {
  let setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true })
  let platform = process.platform
  afterEach(() => setPlatform(platform))

  it('uses cmd.exe only for commands that are not executables', () => {
    setPlatform('win32')
    assert.strictEqual(needsShell('C:/Program Files/server/bin/server.exe'), false)
    assert.strictEqual(needsShell('server.COM'), false)
    assert.strictEqual(needsShell('typescript-language-server'), true)
    assert.strictEqual(needsShell('C:/tools/server.cmd'), true)
    setPlatform('linux')
    assert.strictEqual(needsShell('typescript-language-server'), false)
  })

  it('quotes arguments with whitespace once', () => {
    assert.strictEqual(quoteShellArg('--stdio'), '--stdio')
    assert.strictEqual(quoteShellArg('C:/Users/A B/server.cmd'), '"C:/Users/A B/server.cmd"')
    assert.strictEqual(quoteShellArg('"C:/Users/A B/server.cmd"'), '"C:/Users/A B/server.cmd"')
  })

  it('runs a script from a path with spaces through cmd.exe', { skip: process.platform !== 'win32' }, async () => {
    let fs = await import('fs')
    let os = await import('os')
    let path = await import('path')
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc shell '))
    let script = path.join(dir, 'echo args.cmd')
    fs.writeFileSync(script, '@echo %~1^|%~2\r\n')
    try {
      let line = [script, '--stdio', 'a b'].map(quoteShellArg).join(' ')
      let proc = child_process.spawn(line, [], { shell: true, windowsHide: true })
      let out = ''
      proc.stdout.on('data', data => out += data)
      await once(proc, 'exit')
      assert.strictEqual(out.trim(), '--stdio|a b')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
