import { SnippetString } from '../../snippets/string'

describe('SnippetString', () => {
  it('should recognize snippet strings', () => {
    assert.strictEqual(SnippetString.isSnippetString(new SnippetString()), true)
    assert.strictEqual(SnippetString.isSnippetString({ value: 'text' }), true)
    assert.strictEqual(SnippetString.isSnippetString({ value: 1 }), false)
    assert.strictEqual(SnippetString.isSnippetString(null), false)
    assert.strictEqual(SnippetString.isSnippetString(undefined), false)
  })

  it('should construct with an initial value', () => {
    assert.strictEqual(new SnippetString().value, '')
    assert.strictEqual(new SnippetString('hello').value, 'hello')
  })

  it('should append escaped text', () => {
    let snippet = new SnippetString()
    snippet.appendText('a$b}c\\d')
    assert.strictEqual(snippet.value, 'a\\$b\\}c\\\\d')
  })

  it('should append tabstops with automatic and explicit numbers', () => {
    let snippet = new SnippetString()
    snippet.appendTabstop()
    snippet.appendTabstop()
    snippet.appendTabstop(5)
    assert.strictEqual(snippet.value, '$1$2$5')
  })

  it('should append placeholders', () => {
    let snippet = new SnippetString()
    snippet.appendPlaceholder('text')
    snippet.appendPlaceholder('a$b', 3)
    assert.strictEqual(snippet.value, '${1:text}${3:a\\$b}')
  })

  it('should append placeholder with nested snippet function', () => {
    let snippet = new SnippetString()
    snippet.appendPlaceholder(nested => {
      nested.appendText('x')
      nested.appendTabstop()
    })
    assert.strictEqual(snippet.value, '${1:x$2}')
  })

  it('should append choices with escaping', () => {
    let snippet = new SnippetString()
    snippet.appendChoice(['a', 'b'], 2)
    snippet.appendChoice(['a|b', 'c,d'], 3)
    assert.strictEqual(snippet.value, '${2|a,b|}${3|a\\|b,c\\,d|}')
  })

  it('should append variables', () => {
    let snippet = new SnippetString()
    snippet.appendVariable('TM_SELECTED_TEXT')
    snippet.appendVariable('TM_FILENAME', 'file$name}')
    snippet.appendVariable('TM_CURRENT_LINE', nested => {
      nested.appendText('line')
      nested.appendTabstop()
    })
    assert.strictEqual(snippet.value, '${TM_SELECTED_TEXT}${TM_FILENAME:file\\$name\\}}${TM_CURRENT_LINE:line$1}')
  })

  it('should share tabstop counter with nested placeholders', () => {
    let snippet = new SnippetString()
    snippet.appendTabstop()
    snippet.appendPlaceholder(nested => {
      nested.appendTabstop()
    })
    snippet.appendTabstop()
    assert.strictEqual(snippet.value, '$1${2:$3}$4')
  })
})
