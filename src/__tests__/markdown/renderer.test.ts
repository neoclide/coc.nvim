import marked from 'marked'
import Renderer from '../../markdown/renderer'
import { parseAnsiHighlights, AnsiResult } from '../../util/ansiparse'

marked.setOptions({
  smartypants: true,
  renderer: new Renderer()
})

function parse(text: string): AnsiResult {
  let m = marked(text)
  let res = parseAnsiHighlights(m.split(/\n/)[0], true)
  return res
}

describe('Renderer of marked', () => {
  it('should create bold highlights', async () => {
    let res = parse('**note**.')
    expect(res.highlights[0]).toEqual({
      span: [0, 4],
      hlGroup: 'CocBold'
    })
  })

  it('should create italic highlights', async () => {
    let res = parse('_note_.')
    expect(res.highlights[0]).toEqual({
      span: [0, 4],
      hlGroup: 'CocItalic'
    })
  })

  it('should create underline highlights for link', async () => {
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
  })

  it('should parse link', async () => {
    // let res = parse('https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v')
    // console.log(JSON.stringify(res, null, 2))
    let parsed = marked('https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v')
    let res = parseAnsiHighlights(parsed.split(/\n/)[0], true)
  })

  it('should create highlight for code span', async () => {
    let res = parse('`let foo = "bar"`')
    expect(res.highlights[0]).toEqual({
      span: [0, 15],
      hlGroup: 'CocMarkdownCode'
    })
  })

  it('should create header highlights', async () => {
    let res = parse('# header')
    expect(res.highlights[0]).toEqual({
      span: [0, 8],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('## header')
    expect(res.highlights[0]).toEqual({
      span: [0, 9],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('### header')
    expect(res.highlights[0]).toEqual({
      span: [0, 10],
      hlGroup: 'CocMarkdownHeader'
    })
  })

  it('should indent blockquote', async () => {
    let res = parse('> header')
    expect(res.line).toBe('  header')
  })

  it('should preserve code block', async () => {
    let text = '``` js\nconsole.log("foo")\n```'
    let m = marked(text)
    expect(m.split('\n')).toEqual([
      '``` js',
      'console.log("foo")',
      '```',
      ''
    ])
  })
})
