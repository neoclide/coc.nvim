import { marked } from 'marked'
import Renderer, { bulletPointLine, fixHardReturn, generateTableRow, identify, numberedLine, toSpaces, toSpecialSpaces } from '../../markdown/renderer'
import * as styles from '../../markdown/styles'
import { parseAnsiHighlights, AnsiResult } from '../../util/ansiparse'

marked.setOptions({
  renderer: new Renderer(),
  hooks: Renderer.hooks,
})

function parse(text: string): AnsiResult {
  let m = marked(text)
  let res = parseAnsiHighlights(m.split(/\n/)[0], true)
  return res
}

describe('styles', () => {
  it('should add styles', () => {
    let keys = ['gray', 'magenta', 'bold', 'underline', 'italic', 'strikethrough', 'yellow', 'green', 'blue']
    for (let key of keys) {
      let res = styles[key]('text')
      expect(res).toContain('text')
    }
  })
})

describe('Renderer of marked', () => {
  it('should convert', () => {
    expect(identify('  ', '')).toBe('')
    expect(fixHardReturn('a\rb', true)).toBe('a\nb')
    expect(toSpaces('ab')).toBe('  ')
    expect(toSpecialSpaces('ab')).toBe('\0\0\0\0\0\0')
    expect(bulletPointLine('  ', '  * foo')).toBe('  * foo')
    expect(bulletPointLine('  ', 'foo')).toBe('\0\0\0\0\0\0foo')
    expect(bulletPointLine('  ', '\0\0\0foo')).toBe('\0\0\0foo')
    expect(generateTableRow('')).toEqual([])
    expect(numberedLine('  ', 'foo', 1).line).toBe('   foo')
  })

  it('should create bold highlights', () => {
    let res = parse('**note**.')
    expect(res.highlights[0]).toEqual({
      span: [0, 4],
      hlGroup: 'CocBold'
    })
  })

  it('should create italic highlights', () => {
    let res = parse('_note_.')
    expect(res.highlights[0]).toEqual({
      span: [0, 4],
      hlGroup: 'CocItalic'
    })
  })

  it('should create underline highlights for link', () => {
    let res = parse('[baidu](https://baidu.com)')
    expect(res.highlights[0]).toEqual({
      span: [0, 5],
      hlGroup: 'CocMarkdownLink'
    })
    res = parse('https://baidu.com')
    expect(res.highlights[0]).toEqual({
      span: [0, 17],
      hlGroup: 'CocUnderline'
    })
    res = parse('https://baidu.com/%25E0%25A4%25A')
    expect(res.line).toBe('')
  })

  it('should parse link', () => {
    // let res = parse('https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v')
    // console.log(JSON.stringify(res, null, 2))
    let link = 'https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v'
    let parsed = marked(link)
    let res = parseAnsiHighlights(parsed.split(/\n/)[0], true)
    expect(res.line).toEqual(link)
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.highlights[0].hlGroup).toBe('CocUnderline')
  })

  it('should create highlight for code span', () => {
    let res = parse('`let foo = "bar"`')
    expect(res.highlights[0]).toEqual({
      span: [0, 15],
      hlGroup: 'CocMarkdownCode'
    })
  })

  it('should create header highlights', () => {
    let res = parse('# header')
    expect(res.highlights[0]).toEqual({
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('## header')
    expect(res.highlights[0]).toEqual({
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('### header')
    expect(res.highlights[0]).toEqual({
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
  })

  it('should indent blockquote', () => {
    let res = parse('> header')
    expect(res.line).toBe('  header')
  })

  it('should parse image', async () => {
    let res = parse('![title](http://www.baidu.com)')
    expect(res.line).toMatch('baidu')
  })

  it('should preserve code block', () => {
    let text = '``` js\nconsole.log("foo")\n```'
    let m = marked(text)
    expect(m.split('\n')).toEqual([
      '``` js',
      'console.log("foo")',
      '```',
      ''
    ])
  })

  it('should renderer table', () => {
    let text = `
| Syntax      | Description |
| ----------- | ----------- |
| Header      | Title       |
| Paragraph   | Text        |
`
    let res = marked(text)
    expect(res).toContain('Syntax')
  })
})
