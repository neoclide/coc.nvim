local api =vim.api

local M = {}
-- Get single line extmarks
function M.getHighlights(bufnr, key)
  local loaded = api.nvim_call_function('bufloaded', { bufnr })
  if loaded == 0 then
    return nil
  end
  local ns = api.nvim_create_namespace('coc-'..key)
  local total = api.nvim_buf_line_count(bufnr)
  local markers = api.nvim_buf_get_extmarks(bufnr, ns, 0, -1, {details = true})
  local res = {}
  for i = 1, #markers do
    local id = markers[i][1]
    local line = markers[i][2]
    local start_col = markers[i][3]
    local details = markers[i][4]
    local end_col = details.end_col
    if line >= total then goto continue end
    local delta = details.end_row - line
    if delta > 1 then goto continue end
    if delta == 1 and end_col ~= 0 then goto continue end
    if delta == 1 then
      end_col = api.nvim_eval('strlen(get(getbufline('..bufnr..','..(line+1)..'), 0, ""))')
    end
    if start_col == end_col then
      api.nvim_buf_del_extmark(bufnr, ns, id)
      goto continue
    end
    table.insert(res, {details.hl_group, line, start_col, end_col, id})
    ::continue::
  end
  return res
end

return M
