/* tslint:disable:no-console */
import {Neovim} from '@chemzqm/neovim'
import helper, {createTmpFile} from '../helper'
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
  test('should start task', async () => {
    let task = workspace.createTask('sleep')
    let started = await task.start({cmd: 'sleep', args: ['50']})
    expect(started).toBe(true)
    task.dispose()
  })

  test('should stop task', async () => {
    let task = workspace.createTask('sleep')
    await task.start({cmd: 'sleep', args: ['50']})
    await helper.wait(10)
    await task.stop()
    let running = await task.running
    expect(running).toBe(false)
    task.dispose()
  })

  test('should emit exit event', async () => {
    let fn = jest.fn()
    let task = workspace.createTask('sleep')
    task.onExit(fn)
    await task.start({cmd: 'sleep', args: ['50']})
    await helper.wait(10)
    await task.stop()
    task.dispose()
    expect(fn).toBeCalled()
  })

  test('should emit stdout event', async () => {
    let file = await createTmpFile('echo foo')
    let fn = jest.fn()
    let task = workspace.createTask('echo')
    let called = false
    task.onStdout(lines => {
      if (!called) expect(lines).toEqual(['foo'])
      called = true
      fn()
    })
    await task.start({cmd: '/bin/sh', args: [file]})
    await helper.wait(300)
    task.dispose()
    expect(fn).toBeCalled()
  })

  test('should emit stderr event', async () => {
    let file = await createTmpFile('console.error("error")')
    let fn = jest.fn()
    let task = workspace.createTask('error')
    task.onStderr(lines => {
      expect(lines).toEqual(['error'])
      fn()
    })
    await task.start({cmd: 'node', args: [file]})
    await helper.wait(300)
    task.dispose()
    expect(fn).toBeCalled()
  })
})
