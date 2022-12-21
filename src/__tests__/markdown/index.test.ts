import { getHighlightItems, toFiletype, parseMarkdown, parseDocuments } from '../../markdown/index'
import { Documentation } from '../../types'

describe('getHighlightItems', () => {
  it('should convert filetype', () => {
    expect(toFiletype(undefined)).toBe('txt')
    expect(toFiletype('ts')).toBe('typescript')
    expect(toFiletype('js')).toBe('javascript')
    expect(toFiletype('bash')).toBe('sh')
  })

  it('should get highlights in single line', () => {
    let res = getHighlightItems('this line has highlights', 0, [10, 15])
    expect(res).toEqual([{
      colStart: 10,
      colEnd: 15,
      lnum: 0,
      hlGroup: 'CocFloatActive'
    }])
  })

  it('should get highlights when active end extended', () => {
    let res = getHighlightItems('this line', 0, [5, 30])
    expect(res).toEqual([{
      colStart: 5,
      colEnd: 9,
      lnum: 0,
      hlGroup: 'CocFloatActive'
    }])
  })

  it('should get highlights across line', () => {
    let res = getHighlightItems('this line\nhas highlights', 0, [5, 15])
    expect(res).toEqual([{
      colStart: 5, colEnd: 9, lnum: 0, hlGroup: 'CocFloatActive'
    }, {
      colStart: 0, colEnd: 5, lnum: 1, hlGroup: 'CocFloatActive'
    }])
    res = getHighlightItems('a\nb\nc\nd', 0, [2, 5])
    expect(res).toEqual([
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
    expect(res.lines).toEqual([
      'var global = globalThis',
      '',
      'let str:string',
      '',
      'if'
    ])
    expect(res.codes).toEqual([
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
    expect(res.lines).toEqual([
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
    expect(res.lines).toEqual(['example:', '<div>code</div>'])
    expect(res.codes).toEqual([{ filetype: 'html', startLine: 1, endLine: 2 }])
  })

  it('should merge empty lines', async () => {
    let content = `
https://baidu.com/%25E0%25A4%25A
foo



bar
 `
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['foo', '', 'bar'])
  })

  it('should compose empty lines', () => {
    let content = 'foo\n\n\nbar\n\n\n'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['foo', '', 'bar'])
  })

  it('should merge lines', () => {
    let content = 'first\nsecond'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['first', 'second'])
  })

  it('should parse ansi highlights', () => {
    let content = '__foo__\n[link](link)'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['foo', 'link'])
    expect(res.highlights).toEqual([
      { hlGroup: 'CocBold', lnum: 0, colStart: 0, colEnd: 3 },
      { hlGroup: 'CocUnderline', lnum: 1, colStart: 0, colEnd: 4 }
    ])
  })

  it('should exclude images by option', () => {
    let content = 'head\n![img](img)\ncontent ![img](img) ![img](img)'
    let res = parseMarkdown(content, { excludeImages: false })
    expect(res.lines).toEqual(['head', '![img](img)', 'content ![img](img) ![img](img)'])
    content = 'head\n![img](img)\ncontent ![img](img) ![img](img)'
    res = parseMarkdown(content, { excludeImages: true })
    expect(res.lines).toEqual(['head', 'content'])
  })

  it('should render hr', () => {
    let content = 'foo\n***\nbar'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['foo', '───', 'bar'])
  })

  it('should render deleted text', () => {
    let content = '~foo~'
    let res = parseMarkdown(content, {})
    expect(res.highlights).toEqual([
      { hlGroup: 'CocStrikeThrough', lnum: 0, colStart: 0, colEnd: 3 }
    ])
  })

  it('should render br', () => {
    let content = 'a  \nb'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['a', 'b'])
  })

  it('should render code span', () => {
    let content = '`foo`'
    let res = parseMarkdown(content, {})
    expect(res.highlights).toEqual([
      { hlGroup: 'CocMarkdownCode', lnum: 0, colStart: 0, colEnd: 3 }
    ])
  })

  it('should render html', () => {
    let content = '<div>foo</div>'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual(['foo'])
  })

  it('should render checkbox', () => {
    let content = '- [x] first\n- [ ] second'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual([
      '  * [X] first', '  * [ ] second'
    ])
  })

  it('should render numbered list', () => {
    let content = '1. one\n2. two\n3. three'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual([
      '  1. one', '  2. two', '  3. three'
    ])
  })

  it('should render nested list', () => {
    let content = '- foo\n- bar\n    - one\n    - two'
    let res = parseMarkdown(content, {})
    expect(res.lines).toEqual([
      '  * foo', '  * bar', '    * one', '    * two'
    ])
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
    expect(res.lines).toEqual([
      'Error text',
      '─',
      'Warning text'
    ])
    expect(res.codes).toEqual([
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
    expect(res.lines).toEqual([
      'const workspace',
      '─',
      'header'
    ])
    expect(res.highlights).toEqual([{
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
    expect(res.codes).toEqual([
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
    expect(highlights[1]).toEqual({ lnum: 2, colStart: 4, colEnd: 7, hlGroup: 'String' })
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
    expect(res.highlights[0]).toEqual({ colStart: 5, colEnd: 8, lnum: 0, hlGroup: 'CocFloatActive' })
  })
})
