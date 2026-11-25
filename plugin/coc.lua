if vim.fn.has('nvim-0.10') then
  vim.api.nvim_create_autocmd({ 'BufEnter' }, {
    callback = function()
      -- DiagnosticChanged can redraw before Neovim restores the buffer's cursor.
      vim.schedule(require('coc.diagnostic').refresh)
    end,
  })

  vim.api.nvim_create_autocmd('User', {
    pattern = 'CocDiagnosticChange',
    callback = function()
      require('coc.diagnostic').refresh()
    end,
  })
end
