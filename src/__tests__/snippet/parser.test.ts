import {
  SnippetParser,
  Marker,
} from '../../snippet/parser'

describe('snippet parser', () => {
  test('parse a snippet', () => {
    let text = '$0console.log(${1:abc}) $1 $1'
    let snippet = new SnippetParser().parse(text)
    let str = snippet.toString()
    // console.log(snippet.children)
    let m = snippet.children[1] as Marker
    for (let marker of snippet.children) {
      // let res = snippet.children.filter(m => {
      //   return m === marker
      // })
      console.log(marker)
      // console.log(marker.toString().length)
      // console.log(marker.len())
    }
    // let placeholder = snippet.placeholders[0]
    // console.log(placeholder.children)
    // console.log(snippet.offset(m))
  })

  test('parse snippet with stop only', () => {
    let text = 'console.log()$0'
    let snippet = new SnippetParser().parse(text)
    // console.log(snippet.children)
    console.log(snippet.placeholders)
    let placeholder = snippet.placeholders[0]
    console.log(placeholder)
    console.log(snippet.offset(placeholder))
    expect(1).toBe(2)
  })
})
