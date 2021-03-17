import { Position, Range } from 'vscode-languageserver-protocol'
import { LinesTextDocument } from '../../model/textdocument'

function createTextDocument(lines: string[]): LinesTextDocument {
  return new LinesTextDocument('file://a', 'txt', 1, lines, true)
}

describe('LinesTextDocument', () => {
  it('should get line count and content', async () => {
    let doc = createTextDocument(['a', 'b'])
    expect(doc.lineCount).toBe(3)
    let content = doc.getText()
    expect(content).toBe('a\nb\n')
  })

  it('should get position', async () => {
    let doc = createTextDocument(['foo', 'bar'])
    let pos = doc.positionAt(4)
    expect(pos).toEqual({ line: 1, character: 0 })
  })

  it('should get content by range', async () => {
    let doc = createTextDocument(['foo', 'bar'])
    let content = doc.getText(Range.create(0, 0, 0, 3))
    expect(content).toBe('foo')
  })

  it('should get offset', async () => {
    let doc = createTextDocument(['foo', 'bar'])
    let offset = doc.offsetAt(Position.create(0, 4))
    expect(offset).toBe(4)
    offset = doc.offsetAt(Position.create(2, 1))
    expect(offset).toBe(8)
  })
})
