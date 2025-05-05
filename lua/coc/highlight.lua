local api = vim.api

local M = {}

local function create_namespace(key)
  if type(key) == 'number' then
    return key
  end
  return api.nvim_create_namespace('coc-' .. key)
end

-- Get single line extmarks
function M.getHighlights(bufnr, key, s, e)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  s = s or 0
  e = e or -1
  local max = e == -1 and api.nvim_buf_line_count(bufnr) or e + 1
  local ns = create_namespace(key)
  local markers = api.nvim_buf_get_extmarks(bufnr, ns, {s, 0}, {e, -1}, {details = true})
  local res = {}
  for _, mark in ipairs(markers) do
    local id = mark[1]
    local line = mark[2]
    local startCol = mark[3]
    local details = mark[4] or {}
    local endCol = details.end_col
    if line < max then
      local delta = details.end_row - line
      if delta <= 1 and (delta == 0 or endCol == 0) then
        if startCol == endCol then
          api.nvim_buf_del_extmark(bufnr, ns, id)
        else
          if delta == 1 then
            local text = api.nvim_buf_get_lines(bufnr, line, line + 1, false)[1] or ''
            endCol = #text
          end
          table.insert(res, {details.hl_group, line, startCol, endCol, id})
        end
      end
    end
  end
  return res
end

local function addHighlights(bufnr, ns, highlights, priority)
  for _, items in ipairs(highlights) do
    local hlGroup = items[1]
    local line = items[2]
    local startCol = items[3]
    local endCol = items[4]
    local hlMode = items[5] and 'combine' or 'replace'
    -- Error: col value outside range
    pcall(api.nvim_buf_set_extmark, bufnr, ns, line, startCol, {
          end_col = endCol,
          hl_group = hlGroup,
          hl_mode = hlMode,
          right_gravity = true,
          priority = type(priority) == 'number' and math.min(priority, 4096) or 4096
    })
  end
end

local function addHighlightTimer(bufnr, ns, highlights, priority, changedtick, maxCount)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  if vim.fn.getbufvar(bufnr, 'changedtick', 0) ~= changedtick then
    return nil
  end
  if #highlights > maxCount then
    local hls = {}
    local next = {}
    table.move(highlights, 1, maxCount, 1, hls)
    table.move(highlights, maxCount + 1, #highlights, 1, next)
    addHighlights(bufnr, ns, hls, priority)
    vim.defer_fn(function()
      addHighlightTimer(bufnr, ns, next, priority, changedtick, maxCount)
    end, 10)
  else
    addHighlights(bufnr, ns, highlights, priority)
  end
end

function M.del_markers(bufnr, key, ids)
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    for _, id in ipairs(ids) do
      api.nvim_buf_del_extmark(bufnr, ns, id)
    end
  end
end

function M.set_highlights(bufnr, key, highlights, priority)
  local changedtick = vim.fn.getbufvar(bufnr, 'changedtick', 0)
  local maxCount = vim.g.coc_highlight_maximum_count or 500
  local ns = create_namespace(key)
  addHighlightTimer(bufnr, ns, highlights, priority, changedtick, maxCount)
end

function M.clear_highlights(id, key, start_line, end_line)
  local bufnr = id == 0 and api.nvim_get_current_buf() or id
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    api.nvim_buf_clear_namespace(bufnr, ns, start_line, end_line)
  end
end

return M
