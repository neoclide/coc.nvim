import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {runProcessPool} from './process-pool.mjs'

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return {promise, resolve}
}

describe('process pool', () => {
  it('fills all slots and starts the next task as soon as one completes', async () => {
    const releases = new Map()
    const changes = []
    let active = 0
    let maxActive = 0
    let notify
    const changed = () => new Promise(resolve => {
      notify = resolve
    })
    const running = runProcessPool(['a', 'b', 'c', 'd'], 2, async item => {
      active++
      maxActive = Math.max(maxActive, active)
      changes.push(`start:${item}`)
      const gate = deferred()
      releases.set(item, gate.resolve)
      notify?.()
      await gate.promise
      active--
      changes.push(`end:${item}`)
      notify?.()
      return item.toUpperCase()
    })

    while (releases.size < 2) await changed()
    assert.deepEqual([...releases.keys()], ['a', 'b'])
    releases.get('a')()
    while (!releases.has('c')) await changed()
    assert.equal(active, 2)
    releases.get('b')()
    while (!releases.has('d')) await changed()
    releases.get('c')()
    releases.get('d')()

    assert.deepEqual(await running, ['A', 'B', 'C', 'D'])
    assert.equal(maxActive, 2)
    assert.ok(changes.indexOf('start:c') < changes.indexOf('end:b'))
  })

  it('stops dispatch and aborts active tasks after an infrastructure error', async () => {
    const started = []
    const aborted = []
    const failure = new Error('worker failed')
    await assert.rejects(
      runProcessPool(['a', 'b', 'c'], 2, async (item, _index, signal) => {
        started.push(item)
        if (item === 'a') throw failure
        await new Promise(resolve => {
          signal.addEventListener('abort', () => {
            aborted.push(item)
            resolve(undefined)
          }, {once: true})
        })
      }),
      failure
    )
    assert.deepEqual(started, ['a', 'b'])
    assert.deepEqual(aborted, ['b'])
  })
})
