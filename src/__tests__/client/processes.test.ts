import { terminate } from '../../util/processes'
import { spawn } from 'child_process'

describe('terminate', () => {

  it('should terminate process', () => {
    let cwd = process.cwd()
    let child = spawn('sleep', ['10'], { cwd, detached: true })
    let res = terminate(child, cwd)
    expect(res).toBe(true)
    expect(child.connected).toBe(false)
  })
})
