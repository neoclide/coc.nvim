import {
  SnippetParser,
} from '../../snippet/parser'

describe('snippet parser', () => {
  test('parse a snippet', () => {
    let text = 'console.log("${1:abc}")$0'
    let snippet = new SnippetParser().parse(text)
    let str = snippet.toString()
    expect(str).toBe('console.log("abc")')
    expect(snippet.placeholders.length).toBe(2)
    let placeholder = snippet.placeholders[0]
    expect(placeholder.len()).toEqual(0)
  })

  test('parse snippet with stop only', () => {
    let text = 'console.log()$0'
    let snippet = new SnippetParser().parse(text)
    // console.log(snippet.children)
    let placeholder = snippet.placeholders[0]
    expect(snippet.offset(placeholder)).toBe(13)
  })

  test('parse choice', () => {
    let text = 'main(${1|one,two,three|})'
    let snippet = new SnippetParser().parse(text, true, true)
    let placeholder = snippet.placeholders[0]
    console.log(placeholder.len())
    console.log(placeholder.choice.toString())
    console.log(placeholder.choice.len())
    console.log(placeholder.choice)
    console.log(placeholder.choice.options.map(o => o.value))
  })
})
