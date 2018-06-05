import StdioService from '../model/stdioService'
import path = require('path')

describe('child model test', () => {
  let ch:StdioService

  beforeAll(() => {
    let file = path.resolve(__dirname, '../../bin/jedi_server.py')
    ch = new StdioService('python', [file, '-v'])
    ch.start()
  })

  afterAll(() => {
    ch.stop()
  })

  test('jedi server works', async () => {
    let res = await ch.request(JSON.stringify({
      action: 'complete',
      line: 3,
      col: 'datetime.da'.length,
      filename: 'example.py',
      content: '\nimport datetime\ndatetime.da',
    }))
    let items = JSON.parse(res)
    expect(items.length).toBeGreaterThan(1)
  })
})
