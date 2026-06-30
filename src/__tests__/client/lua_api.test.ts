import helper from '../helper'

let nvim: any

beforeAll(async () => {
  await helper.setup()
  nvim = helper.workspace.nvim
  // Simulate what client.vim's s:start() does: expose channel id for Lua RPC
  await nvim.command('let g:coc_channel_id = 1')
})

afterAll(async () => {
  await helper.shutdown()
})

describe('lua api wrapper', () => {
  it('should load require("coc") without error', async () => {
    const ok = await nvim.request('nvim_exec_lua', [`local r, e = pcall(require, 'coc'); return r`, []])
    expect(ok).toBe(true)
  })

  it('get_diagnostics should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.get_diagnostics) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('get_config should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.get_config) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('workspace_symbols should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.workspace_symbols) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('document_symbols should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.document_symbols) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('execute_command should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.execute_command) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('command_list should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.command_list) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('extension_stats should exist', async () => {
    const ok = await nvim.request('nvim_exec_lua', [
      `local ok, coc = pcall(require, 'coc'); return ok and type(coc.extension_stats) == 'function'`, []
    ])
    expect(ok).toBe(true)
  })

  it('get_diagnostics should return table when called', async () => {
    const result = await nvim.request('nvim_exec_lua', [
      `return require('coc').get_diagnostics()`, []
    ])
    // should return a table (nil or list) without throwing
    expect(result == null || Array.isArray(result)).toBe(true)
  })

  it('get_config should return config', async () => {
    const result = await nvim.request('nvim_exec_lua', [
      `return require('coc').get_config('suggest')`, []
    ])
    // should return a table without throwing
    expect(result == null || typeof result === 'object').toBe(true)
  })
})
