import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import LineBuilder from '../../model/line'

describe('LineBuilder', () => {
  it('should append', async () => {
    let line = new LineBuilder(true)
    line.append('')
    line.append('text')
    line.append('comment', 'Comment')
    line.append('nested', undefined, [{ hlGroup: 'Search', offset: 1, length: 2 }])
    assert.strictEqual(line.label, 'text comment nested')
    assert.deepStrictEqual(line.highlights, [
      { hlGroup: 'Comment', span: [5, 12] },
      { hlGroup: 'Search', span: [14, 16] }
    ])
    let other = new LineBuilder()
    other.append('text', 'More')
    line.appendBuilder(other)
    assert.strictEqual(line.label, 'text comment nested text')
    assert.deepStrictEqual(line.highlights, [
      { hlGroup: 'Comment', span: [5, 12] },
      { hlGroup: 'Search', span: [14, 16] },
      { hlGroup: 'More', span: [20, 24] }
    ])
  })

  it('should append without space', async () => {
    let line = new LineBuilder(false)
    line.append('text')
    let other = new LineBuilder()
    other.append('text', 'More')
    line.appendBuilder(other)
    assert.strictEqual(line.label, 'texttext')
    assert.deepStrictEqual(line.highlights, [
      { hlGroup: 'More', span: [4, 8] }
    ])
  })
})
