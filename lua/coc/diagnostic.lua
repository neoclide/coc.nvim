local M = {}

local ns = vim.api.nvim_create_namespace('coc-diagnostic')

function M.refresh()
  vim.diagnostic.reset(ns)

  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(bufnr) then
      local ok, items = pcall(vim.api.nvim_buf_get_var, bufnr, 'coc_diagnostic_map')
      if ok and type(items) == 'table' and vim.tbl_count(items) >= 0 then
        local diagnostics = {}
        for _, d in ipairs(items) do
          diagnostics[#diagnostics + 1] = {
            bufnr = bufnr,
            lnum = d.location.range.start.line,
            end_lnum = d.location.range['end'].line,
            col = d.location.range.start.character,
            end_col = d.location.range['end'].character,
            severity = d.level,
            message = d.message,
            source = d.source,
            code = d.code,
            namespace = ns,
          }
        end
        vim.diagnostic.set(ns, bufnr, diagnostics)
      end
    end
  end
end

return M
