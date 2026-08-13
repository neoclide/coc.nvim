import { marked, Renderer as MarkedRenderer } from 'marked'
import Renderer, { bulletPointLine, fixHardReturn, generateTableRow, identify, numberedLine, toSpaces, toSpecialSpaces } from '../../markdown/renderer'
import * as styles from '../../markdown/styles'
import { parseAnsiHighlights, AnsiResult } from '../../util/ansiparse'

marked.setOptions({
  renderer: new Renderer() as MarkedRenderer,
  hooks: Renderer.hooks,
})

function parse(text: string): AnsiResult {
  let m = marked(text)
  let res = parseAnsiHighlights(m.split(/\n/)[0], true)
  return res
}

afterEach(() => {
  // clear module-level link map so leftovers don't leak into other files
  // sharing the same no-isolate worker
  Renderer.getLinks()
})

describe('styles', () => {
  it('should add styles', () => {
    let keys = ['gray', 'magenta', 'bold', 'underline', 'italic', 'strikethrough', 'yellow', 'green', 'blue']
    for (let key of keys) {
      let res = styles[key]('text')
      assert.ok(res.includes('text'))
    }
  })
})

describe('Renderer of marked', () => {
  it('should convert', () => {
    assert.strictEqual(identify('  ', ''), '')
    assert.strictEqual(fixHardReturn('a\rb', true), 'a\nb')
    assert.strictEqual(toSpaces('ab'), '  ')
    assert.strictEqual(toSpecialSpaces('ab'), '\0\0\0\0\0\0')
    assert.strictEqual(bulletPointLine('  ', '  * foo'), '  * foo')
    assert.strictEqual(bulletPointLine('  ', 'foo'), '\0\0\0\0\0\0foo')
    assert.strictEqual(bulletPointLine('  ', '\0\0\0foo'), '\0\0\0foo')
    assert.deepStrictEqual(generateTableRow(''), [])
    assert.strictEqual(numberedLine('  ', 'foo', 1).line, '   foo')
  })

  it('should create bold highlights', () => {
    let res = parse('**note**.')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 4],
      hlGroup: 'CocBold'
    })
  })

  it('should create italic highlights', () => {
    let res = parse('_note_.')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 4],
      hlGroup: 'CocItalic'
    })
  })

  it('should create underline highlights for link', () => {
    let res = parse('[baidu](https://baidu.com)')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 5],
      hlGroup: 'CocMarkdownLink'
    })
    res = parse('https://baidu.com')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 17],
      hlGroup: 'CocUnderline'
    })
    res = parse('https://baidu.com/%25E0%25A4%25A')
    assert.strictEqual(res.line, '')
  })

  it('should parse link', () => {
    // let res = parse('https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v')
    // console.log(JSON.stringify(res, null, 2))
    let link = 'https://doc.rust-lang.org/nightly/core/iter/traits/iterator/Iterator.t.html#map.v'
    let parsed = marked(link)
    let res = parseAnsiHighlights(parsed.split(/\n/)[0], true)
    assert.deepStrictEqual(res.line, link)
    assert.ok(res.highlights.length > 0)
    assert.strictEqual(res.highlights[0].hlGroup, 'CocUnderline')
  })

  it('should create highlight for code span', () => {
    let res = parse('`let foo = "bar"`')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 15],
      hlGroup: 'CocMarkdownCode'
    })
  })

  it('should create header highlights', () => {
    let res = parse('# header')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('## header')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
    res = parse('### header')
    assert.deepStrictEqual(res.highlights[0], {
      span: [0, 6],
      hlGroup: 'CocMarkdownHeader'
    })
  })

  it('should indent blockquote', () => {
    let res = parse('> header')
    assert.strictEqual(res.line, '  header')
  })

  it('should parse image', async () => {
    let res = parse('![title](http://www.baidu.com)')
    assert.match(res.line, new RegExp('baidu'))
  })

  it('should preserve code block', () => {
    let text = '``` js\nconsole.log("foo")\n```'
    let m = marked(text)
    assert.deepStrictEqual(m.split('\n'), [
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
    assert.ok(res.includes('Syntax'))
  })
})
