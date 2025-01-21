local M = {}

local ns = vim.api.nvim_create_namespace('coc_diagnostic')

function M.on_diagnostic_change()
  vim.diagnostic.reset(ns)

  local bufnr = vim.api.nvim_get_current_buf()
  local ok, items = pcall(vim.api.nvim_buf_get_var, bufnr, 'coc_diagnostic_map')
  if not ok or type(items) ~= 'table' or vim.tbl_isempty(items) then
    return
  end

  local diagnostics = {}
  for _, d in ipairs(items) do
    diagnostics[#diagnostics + 1] = {
      bufnr = 0,
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

return M
