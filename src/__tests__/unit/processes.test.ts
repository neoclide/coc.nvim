import type { ChildProcess, ExecFileOptions } from 'child_process'
import { once } from 'events'
import { CancellationError } from '../../util/errors'
import { child_process, promisify } from '../../util/node'
import { execWithTimeout } from '../../util/processes'
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
