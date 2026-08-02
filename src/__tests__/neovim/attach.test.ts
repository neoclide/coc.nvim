import { attach } from '../../neovim/attach/attach'

describe('attach', () => {
  it('should throw friendly error when no transport is provided', () => {
    expect(() => attach({})).toThrow('Invalid arguments, could not attach')
  })
})
