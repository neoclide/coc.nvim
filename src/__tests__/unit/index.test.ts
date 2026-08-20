import { getHighlightItems, toFiletype, parseMarkdown, parseDocuments } from '../../markdown/index'
import { Documentation } from '../../types'

describe('getHighlightItems', () => {
  it('should convert filetype', () => {
    assert.strictEqual(toFiletype(undefined), 'txt')
    assert.strictEqual(toFiletype('ts'), 'typescript')
    assert.strictEqual(toFiletype('js'), 'javascript')
    assert.strictEqual(toFiletype('bash'), 'sh')
  })

  it('should get highlights in single line', () => {
    let res = getHighlightItems('this line has highlights', 0, [10, 15])
    assert.deepStrictEqual(res, [{
      colStart: 10,
      colEnd: 15,
      lnum: 0,
      hlGroup: 'CocFloatActive'
    }])
  })

  it('should get highlights when active end extended', () => {
    let res = getHighlightItems('this line', 0, [5, 30])
    assert.deepStrictEqual(res, [{
      colStart: 5,
      colEnd: 9,
      lnum: 0,
      hlGroup: 'CocFloatActive'
    }])
  })

  it('should get highlights across line', () => {
    let res = getHighlightItems('this line\nhas highlights', 0, [5, 15])
    assert.deepStrictEqual(res, [{
      colStart: 5, colEnd: 9, lnum: 0, hlGroup: 'CocFloatActive'
    }, {
      colStart: 0, colEnd: 5, lnum: 1, hlGroup: 'CocFloatActive'
    }])
    res = getHighlightItems('a\nb\nc\nd', 0, [2, 5])
    assert.deepStrictEqual(res, [
      { colStart: 0, colEnd: 1, lnum: 1, hlGroup: 'CocFloatActive' },
      { colStart: 0, colEnd: 1, lnum: 2, hlGroup: 'CocFloatActive' },
      { colStart: 0, colEnd: 0, lnum: 3, hlGroup: 'CocFloatActive' }
    ])
  })
})

describe('parseMarkdown', () => {
  it('should parse code blocks', () => {
    let content = `
\`\`\`js
var global = globalThis
\`\`\`
\`\`\`ts
let str:string
\`\`\`
\`\`\`bash
if
\`\`\`
`
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, [
      'var global = globalThis',
      '',
      'let str:string',
      '',
      'if'
    ])
    assert.deepStrictEqual(res.codes, [
      { filetype: 'javascript', startLine: 0, endLine: 1 },
      { filetype: 'typescript', startLine: 2, endLine: 3 },
      { filetype: 'sh', startLine: 4, endLine: 5 },
    ])
  })

  it('should merge empty lines', () => {
    let content = `
![img](http://img.io)
![img](http://img.io)
[link](http://example.com)
[link](javascript:void(0))
`
    let res = parseMarkdown(content, { excludeImages: true })
    assert.deepStrictEqual(res.lines, [
      'link',
      '',
      'link: http://example.com'
    ])
  })

  it('should parse html code block', () => {
    let content = `
example:
\`\`\`html
<div>code</div>
\`\`\`
    `
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['example:', '<div>code</div>'])
    assert.deepStrictEqual(res.codes, [{ filetype: 'html', startLine: 1, endLine: 2 }])
  })

  it('should merge empty lines', async () => {
    let content = `
https://baidu.com/%25E0%25A4%25A
foo



bar
 `
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['foo', '', 'bar'])
  })

  it('should compose empty lines', () => {
    let content = 'foo\n\n\nbar\n\n\n'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['foo', '', 'bar'])
  })

  it('should merge lines', () => {
    let content = 'first\nsecond'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['first', 'second'])
  })

  it('should parse ansi highlights', () => {
    let content = '__foo__\n[link](link)'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['foo', 'link'])
    assert.deepStrictEqual(res.highlights, [
      { hlGroup: 'CocBold', lnum: 0, colStart: 0, colEnd: 3 },
      { hlGroup: 'CocUnderline', lnum: 1, colStart: 0, colEnd: 4 }
    ])
  })

  it('should retain markdown links for Neovim hyperlink extmarks', () => {
    let res = parseMarkdown('[Coc](https://github.com/neoclide/coc.nvim) and https://neovim.io', {})
    assert.deepStrictEqual(res.lines, ['Coc and https://neovim.io', '', 'Coc: https://github.com/neoclide/coc.nvim'])
    assert.deepStrictEqual(res.links, [
      { lnum: 0, colStart: 0, colEnd: 3, url: 'https://github.com/neoclide/coc.nvim' },
      { lnum: 0, colStart: 8, colEnd: 25, url: 'https://neovim.io' }
    ])
  })

  it('should exclude images by option', () => {
    let content = 'head\n![img](img)\ncontent ![img](img) ![img](img)'
    let res = parseMarkdown(content, { excludeImages: false })
    assert.deepStrictEqual(res.lines, ['head', '![img](img)', 'content ![img](img) ![img](img)'])
    content = 'head\n![img](img)\ncontent ![img](img) ![img](img)'
    res = parseMarkdown(content, { excludeImages: true })
    assert.deepStrictEqual(res.lines, ['head', 'content'])
  })

  it('should render hr', () => {
    let content = 'foo\n***\nbar'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['foo', '───', 'bar'])
  })

  it('should render deleted text', () => {
    let content = '~foo~'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.highlights, [
      { hlGroup: 'CocStrikeThrough', lnum: 0, colStart: 0, colEnd: 3 }
    ])
  })

  it('should render br', () => {
    let content = 'a  \nb'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['a', 'b'])
  })

  it('should render code span', () => {
    let content = '`foo`'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.highlights, [
      { hlGroup: 'CocMarkdownCode', lnum: 0, colStart: 0, colEnd: 3 }
    ])
  })

  it('should render code span in table header', () => {
    let content = [
      '|Type|`size_of::<Type>()`|',
      '|----|-------------------|',
      '|()|0|'
    ].join('\n')
    let res = parseMarkdown(content, {})
    assert.ok(res.lines.includes('│ Type │ size_of::<Type>() │'))
  })

  it('should render html', () => {
    let content = '<div>foo</div>'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, ['foo'])
  })

  it('should render checkbox', () => {
    let content = '- [x] first\n- [ ] second'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, [
      '  * [X] first', '  * [ ] second'
    ])
  })

  it('should render numbered list', () => {
    let content = '1. one\n2. two\n3. three'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, [
      '  1. one', '  2. two', '  3. three'
    ])
  })

  it('should render nested list', () => {
    let content = '- foo\n- bar\n    - one\n    - two'
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, [
      '  * foo', '  * bar', '    * one', '    * two'
    ])
  })

  it('should render complicated nested list', () => {
    let content = `
- greeting
  - hello
    - me
      you
      them
  - hi
    - me
      you
      them
    - him
      her
- bye
- code

  \`\`\`typescript
  function foo () {
          console.log('foo')
    console.log('bar')
  }
  \`\`\`
`
    let res = parseMarkdown(content, {})
    assert.deepStrictEqual(res.lines, `  * greeting
    * hello
      * me
        you
        them
    * hi
      * me
        you
        them
      * him
        her
  * bye
  * code
    function foo () {
            console.log('foo')
      console.log('bar')
    }`.split('\n'))
  })
})

describe('parseDocuments', () => {
  it('should parse documents with diagnostic filetypes', () => {
    let docs = [{
      filetype: 'Error',
      content: 'Error text'
    }, {
      filetype: 'Warning',
      content: 'Warning text'
    }]
    let res = parseDocuments(docs)
    assert.deepStrictEqual(res.lines, [
      'Error text',
      '─',
      'Warning text'
    ])
    assert.deepStrictEqual(res.codes, [
      { hlGroup: 'CocErrorFloat', startLine: 0, endLine: 1 },
      { hlGroup: 'CocWarningFloat', startLine: 2, endLine: 3 }
    ])
  })

  it('should parse markdown document with filetype document', () => {
    let docs = [{
      filetype: 'typescript',
      content: 'const workspace'
    }, {
      filetype: 'markdown',
      content: '**header**'
    }]
    let res = parseDocuments(docs)
    assert.deepStrictEqual(res.lines, [
      'const workspace',
      '─',
      'header'
    ])
    assert.deepStrictEqual(res.highlights, [{
      colEnd: -1,
      colStart: 0,
      hlGroup: "CocFloatDividingLine",
      lnum: 1,
    }, {
      hlGroup: 'CocBold',
      lnum: 2,
      colStart: 0,
      colEnd: 6
    }])
    assert.deepStrictEqual(res.codes, [
      { filetype: 'typescript', startLine: 0, endLine: 1 }
    ])
  })

  it('should parse document with highlights', () => {
    let docs: Documentation[] = [{
      filetype: 'txt',
      content: 'foo'
    }, {
      filetype: 'txt',
      content: 'foo bar',
      highlights: [{
        lnum: 0,
        colStart: 4,
        colEnd: 7,
        hlGroup: 'String'
      }]
    }]
    let res = parseDocuments(docs)
    let { highlights } = res
    assert.deepStrictEqual(highlights[1], { lnum: 2, colStart: 4, colEnd: 7, hlGroup: 'String' })
  })

  it('should parse documents with active highlights', () => {
    let docs = [{
      filetype: 'javascript',
      content: 'func(foo, bar)',
      active: [5, 8]
    }, {
      filetype: 'javascript',
      content: 'func()',
      active: [15, 20]
    }]
    let res = parseDocuments(docs as any)
    assert.deepStrictEqual(res.highlights[0], { colStart: 5, colEnd: 8, lnum: 0, hlGroup: 'CocFloatActive' })
  })
})
