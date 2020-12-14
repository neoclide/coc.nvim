import { Neovim } from '@chemzqm/neovim'
import helper, { createTmpFile } from '../helper'
import workspace from '../../workspace'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('task test', () => {
  it('should start task', async () => {
    let task = workspace.createTask('sleep')
    let started = await task.start({ cmd: 'sleep', args: ['50'] })
    expect(started).toBe(true)
    task.dispose()
  })

  it('should stop task', async () => {
    let task = workspace.createTask('sleep')
    await task.start({ cmd: 'sleep', args: ['50'] })
    await helper.wait(10)
    await task.stop()
    let running = await task.running
    expect(running).toBe(false)
    task.dispose()
  })

  it('should emit exit event', async () => {
    let fn = jest.fn()
    let task = workspace.createTask('sleep')
    task.onExit(fn)
    await task.start({ cmd: 'sleep', args: ['50'] })
    await helper.wait(10)
    await task.stop()
    task.dispose()
    expect(fn).toBeCalled()
  })

  it('should emit stdout event', async () => {
    let file = await createTmpFile('echo foo')
    let fn = jest.fn()
    let task = workspace.createTask('echo')
    let called = false
    task.onStdout(lines => {
      if (!called) expect(lines).toEqual(['foo'])
      called = true
      fn()
    })
    await task.start({ cmd: '/bin/sh', args: [file] })
    await helper.wait(300)
    task.dispose()
    expect(fn).toBeCalled()
  })

  it('should change environment variables', async () => {
    let file = await createTmpFile('echo $NODE_ENV\necho $COC_NVIM_TEST\nsleep 1')
    let task = workspace.createTask('ENV')
    let lines: string[] = []
    task.onStdout(arr => {
      lines.push(...arr)
    })
    await task.start({
      cmd: '/bin/sh',
      args: [file],
      env: {
        NODE_ENV: 'production',
        COC_NVIM_TEST: 'yes'
      }
    })
    await helper.wait(300)
    expect(lines).toEqual(['production', 'yes'])
    let res = await nvim.call('getenv', 'COC_NVIM_TEST')
    expect(res).toBeNull()
    task.dispose()
  })

  it('should receive stdout lines as expected', async () => {
    let file = await createTmpFile('echo 3\necho ""\necho 4')
    let task = workspace.createTask('ENV')
    let lines: string[] = []
    task.onStdout(arr => {
      lines.push(...arr)
    })
    await task.start({
      cmd: '/bin/sh',
      args: [file]
    })
    await helper.wait(300)
    expect(lines).toEqual(['3', '', '4'])
    task.dispose()
  })

  it('should emit stderr event', async () => {
    let file = await createTmpFile('console.error("start\\n\\nend");')
    let fn = jest.fn()
    let task = workspace.createTask('error')
    let lines: string[] = []
    task.onStderr(arr => {
      lines.push(...arr)
      fn()
    })
    await task.start({ cmd: 'node', args: [file] })
    await helper.wait(300)
    expect(lines).toEqual(['start', '', 'end'])
    task.dispose()
    expect(fn).toBeCalled()
  })
})
