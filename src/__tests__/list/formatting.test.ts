import { formatPath, UnformattedListItem, formatListItems } from '../../list/formatting'

describe('formatPath()', () => {
  it('should format path', async () => {
    expect(formatPath('hidden', 'path')).toBe('')
    expect(formatPath('full', __filename)).toMatch('formatting.test.ts')
    expect(formatPath('short', __filename)).toMatch('formatting.test.ts')
    expect(formatPath('filename', __filename)).toMatch('formatting.test.ts')
  })
})

describe('formatListItems', () => {
  it('should format list items', async () => {
    expect(formatListItems(false, [])).toEqual([])
    let items: UnformattedListItem[] = [{
      label: ['a', 'b', 'c']
    }]
    expect(formatListItems(false, items)).toEqual([{
      label: 'a\tb\tc'
    }])
    items = [{
      label: ['a', 'b', 'c']
    }, {
      label: ['foo', 'bar', 'go']
    }]
    expect(formatListItems(true, items)).toEqual([{
      label: 'a  \tb  \tc '
    }, {
      label: 'foo\tbar\tgo'
    }])
  })
})
