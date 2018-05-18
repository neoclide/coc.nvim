import StdioService from '../model/stdioService'
import {wait} from '../util/index'
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
    let result = ''
    let res = await ch.request({
      action: 'complete',
      line: 2,
      col: 'datetime.da'.length,
      filename: 'example.py',
      content: '\nimport datetime\ndatetime.da',
    })
    expect(res.length).toBeGreaterThan(1)
  })
})
