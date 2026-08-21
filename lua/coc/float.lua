local api = vim.api
local M = {}

local hyperlink_ns

function M.add_hyperlinks(winid, links)
  if hyperlink_ns == nil and #links == 0 then
    return
  end
  hyperlink_ns = hyperlink_ns or api.nvim_create_namespace('coc-hyperlinks')
  local bufnr = api.nvim_win_get_buf(winid)
  api.nvim_buf_clear_namespace(bufnr, hyperlink_ns, 0, -1)
  for _, link in ipairs(links) do
    pcall(api.nvim_buf_set_extmark, bufnr, hyperlink_ns, link.lnum, link.colStart, {
      end_col = link.colEnd,
      url = link.url,
    })
  end
end

return M
