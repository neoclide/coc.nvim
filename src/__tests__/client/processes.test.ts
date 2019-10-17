import { spawn } from 'child_process'
import { terminate } from '../../util/processes'
import helper from '../helper'

describe('terminate', () => {
  it('should terminate process', async () => {
    let cwd = process.cwd()
    let child = spawn('sleep', ['10'], { cwd, detached: true })
    let res = terminate(child, cwd)
    await helper.wait(60)
    expect(res).toBe(true)
    expect(child.connected).toBe(false)
  })
})
