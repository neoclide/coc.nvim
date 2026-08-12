'use strict'
import { Neovim } from '@chemzqm/neovim'
import Prompt from '../../list/prompt'
import { IList, ListOptions } from '../../list/types'
import Worker from '../../list/worker'
import helper from '../helper'

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

function createWorker(loadItems: IList['loadItems']): Worker {
  let prompt = new Prompt(nvim)
  let options: ListOptions = {
    position: 'bottom',
    reverse: false,
    input: '',
    ignorecase: false,
    interactive: true,
    sort: true,
    mode: 'insert',
    matcher: 'fuzzy',
    autoPreview: false,
    numberSelect: false,
    noQuit: false,
    first: false
  }
  let list = {
    name: 'test',
    actions: [],
    defaultAction: 'open',
    loadItems
  } as IList
  return new Worker(list, prompt, options)
}

describe('list worker', () => {
  it('resets loading and token when loadItems rejects', async () => {
    let worker = createWorker(() => Promise.reject(new Error('boom')))
    await assert.rejects(worker.loadItems({} as any), error => String(error instanceof Error ? error.message : error).includes('boom'))
    assert.strictEqual(worker.isLoading, false)
    assert.strictEqual((worker as any).tokenSource, null)
  })

  it('a stale cancelled request cannot clobber the state of a newer request', async () => {
    let calls = 0
    let resolveFirst: (v: any) => void = () => {}
    let worker = createWorker(() => {
      calls++
      if (calls === 1) {
        return new Promise(resolve => {
          resolveFirst = resolve
        })
      }
      return Promise.reject(new Error('second boom'))
    })
    let first = worker.loadItems({} as any)
    worker.stop()
    await assert.rejects(worker.loadItems({} as any), error => String(error instanceof Error ? error.message : error).includes('second boom'))
    assert.strictEqual(worker.isLoading, false)
    resolveFirst([{ label: 'x' }])
    await first
    assert.strictEqual(worker.isLoading, false)
    assert.strictEqual(calls, 2)
  })
})
