import LineBuilder from '../../model/line'

describe('LineBuilder', () => {
  it('should append', async () => {
    let line = new LineBuilder(true)
    line.append('')
    line.append('text')
    line.append('comment', 'Comment')
    line.append('nested', undefined, [{ hlGroup: 'Search', offset: 1, length: 2 }])
    expect(line.label).toBe('text comment nested')
    expect(line.highlights).toEqual([
      { hlGroup: 'Comment', span: [5, 12] },
      { hlGroup: 'Search', span: [14, 16] }
    ])
    let other = new LineBuilder()
    other.append('text', 'More')
    line.appendBuilder(other)
    expect(line.label).toBe('text comment nested text')
    expect(line.highlights).toEqual([
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
    expect(line.label).toBe('texttext')
    expect(line.highlights).toEqual([
      { hlGroup: 'More', span: [4, 8] }
    ])
  })
})
