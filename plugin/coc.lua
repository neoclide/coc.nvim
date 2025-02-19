if vim.fn.has('nvim-0.10') then
  vim.api.nvim_create_autocmd({ 'BufEnter' }, {
    callback = function()
      require('coc.diagnostic').refresh()
    end,
  })

  vim.api.nvim_create_autocmd('User', {
    pattern = 'CocDiagnosticChange',
    callback = function()
      require('coc.diagnostic').refresh()
    end,
  })
end
