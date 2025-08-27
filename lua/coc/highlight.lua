local util = require('coc.util')
local api = vim.api

local M = {}

local default_priority = 1024
local priorities = {
  CocListSearch = 2048,
  CocSearch = 2048
}
local diagnostic_hlgroups = {
  CocUnusedHighlight = 0,
  CocDeprecatedHighlight = 1,
  CocHintHighlight = 2,
  CocInfoHighlight = 3,
  CocWarningHighlight = 4,
  CocErrorHighlight = 5
}
local maxCount = vim.g.coc_highlight_maximum_count or 500
local n10 = vim.fn.has('nvim-0.10') == 1 and true or false
-- 16 ms
local maxTimePerBatchMs = 16

local function is_null(value)
  return value == nil or value == vim.NIL
end

local function is_enabled(value)
  return value == 1 or value == true
end

-- 0 based character index to 0 based byte index
local function byte_index(text, character)
  if character == 0 then
    return 0
  end
  local list = vim.str_utf_pos(text)
  local bytes = list[character + 1]
  if bytes == nil then
    return #text
  end
  return bytes - 1
end

local function create_namespace(key)
  if type(key) == 'number' then
    if key == -1 then
      return api.nvim_create_namespace('')
    end
    return key
  end
  if type(key) ~= 'string' then
    error('Expect number or string for namespace key, got ' .. type(key))
  end
  return api.nvim_create_namespace('coc-' .. key)
end

local function get_priority(hl_group, priority)
  if priorities[hl_group] ~= nil then
    return priorities[hl_group]
  end
  if type(priority) ~= 'number' then
    return default_priority
  end
  local n = diagnostic_hlgroups[hl_group]
  if n ~= nil then
    return priority + n
  end
  return priority
end

local function convert_item(item)
  if #item == 0 then
    local combine = 0
    if item.combine or priorities[item.hlGroup] ~= nil then
      combine = 1
    end
    return {item.hlGroup, item.lnum, item.colStart, item.colEnd, combine, item.start_incl, item.end_incl}
  end
  return item
end

local function getValuesWithPrefix(dict, prefix)
  local result = {}
  local prefixLength = #prefix
  for key, value in pairs(dict) do
    if type(key) == 'string' and string.sub(key, 1, prefixLength) == prefix then
      table.insert(result, value)
    end
  end
  return result
end

local function addHighlights(bufnr, ns, highlights, priority)
  for _, items in ipairs(highlights) do
    local converted = convert_item(items)
    local hlGroup = converted[1]
    local line = converted[2]
    local startCol = converted[3]
    local endCol = converted[4]
    local hlMode = is_enabled(converted[5]) and 'combine' or 'replace'
    if endCol == -1 then
      local text = vim.fn.getbufline(bufnr, line + 1)[1] or ''
      endCol = #text
    end
    priority = get_priority(hlGroup, priority)
    -- Error: col value outside range
    pcall(api.nvim_buf_set_extmark, bufnr, ns, line, startCol, {
          end_col = endCol,
          hl_group = hlGroup,
          hl_mode = hlMode,
          right_gravity = true,
          end_right_gravity = is_enabled(converted[7]),
          priority = math.min(priority, 4096)
    })
  end
end

local function addHighlightTimer(bufnr, ns, highlights, priority, changedtick)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  if api.nvim_buf_get_var(bufnr, 'changedtick') ~= changedtick then
    return nil
  end
  local total = #highlights
  local i = 1
  local start = util.getCurrentTime()
  local next = {}
  while i <= total do
    local end_idx = math.min(i + maxCount - 1, total)
    local hls = vim.list_slice(highlights, i, end_idx)
    addHighlights(bufnr, ns, hls, priority)
    local duration = util.getCurrentTime() - start
    if duration > maxTimePerBatchMs and end_idx < total then
      next = vim.list_slice(highlights, end_idx + 1, total)
      break
    end
    i = end_idx + 1
  end
  if #next > 0 then
    vim.defer_fn(function()
      addHighlightTimer(bufnr, ns, next, priority, changedtick)
    end, 10)
  end
end


-- Get single line extmarks
-- @param bufnr - buffer number
-- @param key - namespace id or key string.
-- @param start_line - start line index, default to 0.
-- @param end_line - end line index, default to -1.
function M.get_highlights(bufnr, key, start_line, end_line)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  start_line = type(start_line) == 'number' and start_line or 0
  end_line = type(end_line) == 'number' and end_line or -1
  local max = end_line == -1 and api.nvim_buf_line_count(bufnr) or end_line + 1
  local ns = type(key) == 'number' and key or create_namespace(key)
  local markers = api.nvim_buf_get_extmarks(bufnr, ns, {start_line, 0}, {end_line, -1}, {details = true})
  local res = {}
  for _, mark in ipairs(markers) do
    local id = mark[1]
    local line = mark[2]
    local startCol = mark[3]
    local details = mark[4] or {}
    local endCol = details.end_col
    if line < max then
      local delta = details.end_row - line
      if delta == 1 and endCol == 0 then
        local text = vim.fn.getbufline(bufnr, line + 1)[1] or ''
        endCol = #text
      elseif delta > 0 then
        endCol = -1
      end
      if startCol >= endCol then
        api.nvim_buf_del_extmark(bufnr, ns, id)
      else
        table.insert(res, {details.hl_group, line, startCol, endCol, id})
      end
    end
  end
  return res
end

-- Add single highlight
-- @param id - buffer number or 0 for current buffer.
-- @param key - namespace key or namespace number or -1.
-- @param hl_group - highlight group.
-- @param line - 0 based line index.
-- @param col_start - 0 based col index, inclusive.
-- @param col_end - 0 based col index, exclusive.
-- @param opts - Optional table with priority and combine as boolean.
function M.add_highlight(id, key, hl_group, line, col_start, col_end, opts)
  local bufnr = id == 0 and api.nvim_get_current_buf() or id
  opts = is_null(opts) and {} or opts
  if api.nvim_buf_is_loaded(bufnr) then
    local priority = get_priority(hl_group, opts.priority)
    if col_end == -1 then
      local text = vim.fn.getbufline(bufnr, line + 1)[1] or ''
      col_end = #text
    end
    if col_end > 0 and col_end > col_start then
      local ns = create_namespace(key)
      pcall(api.nvim_buf_set_extmark, bufnr, ns, line, col_start, {
        end_col = col_end,
        hl_group = hl_group,
        hl_mode = is_enabled(opts.combine) and 'combine' or 'replace',
        right_gravity = true,
        end_right_gravity = is_enabled(opts.end_incl),
        priority = math.min(priority, 4096)
      })
    end
  end
end

-- Clear all namespaces with coc- namespace prefix.
function M.clear_all()
  local namespaces = getValuesWithPrefix(api.nvim_get_namespaces(), 'coc-')
  local bufnrs = api.nvim_list_bufs()
  for _, bufnr in ipairs(bufnrs) do
    if api.nvim_buf_is_loaded(bufnr) then
      for _, ns in ipairs(namespaces) do
        api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
      end
    end
  end
end
-- Remove extmarks by id table.
-- @param bufnr - buffer number
-- @param key - namespace id or key string.
-- @param ids - table with ids of extmarks.
function M.del_markers(bufnr, key, ids)
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    for _, id in ipairs(ids) do
      api.nvim_buf_del_extmark(bufnr, ns, id)
    end
  end
end

-- Add highlights to buffer.
-- @param bufnr - buffer number
-- @param key - namespace id or key string.
-- @param highlights - highlight items, item could be HighlightItem dict or number list.
-- @param priority - optional priority
function M.set_highlights(bufnr, key, highlights, priority)
  if api.nvim_buf_is_loaded(bufnr) then
    local changedtick = api.nvim_buf_get_var(bufnr, 'changedtick')
    local ns = create_namespace(key)
    addHighlightTimer(bufnr, ns, highlights, priority, changedtick)
  end
end

-- Clear namespace highlights of region.
-- @param id - buffer number or 0 for current buffer.
-- @param key - namespace id or key string.
-- @param start_line - start line index, default to 0.
-- @param end_line - end line index, default to -1.
function M.clear_highlights(id, key, start_line, end_line)
  local bufnr = id == 0 and api.nvim_get_current_buf() or id
  start_line = type(start_line) == 'number' and start_line or 0
  end_line = type(end_line) == 'number' and end_line or -1
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    api.nvim_buf_clear_namespace(bufnr, ns, start_line, end_line)
  end
end

-- Update highlights of specific region.
-- @param id - buffer number or 0 for current buffer.
-- @param key - namespace id or key string.
-- @param highlights - highlight items, item could be HighlightItem dict or number list.
-- @param start_line - start line index, default to 0.
-- @param end_line - end line index, default to -1.
-- @param priority - optional priority.
-- @param changedtick - optional buffer changedtick.
function M.update_highlights(id, key, highlights, start_line, end_line, priority, changedtick)
  local bufnr = id == 0 and api.nvim_get_current_buf() or id
  start_line = type(start_line) == 'number' and start_line or 0
  end_line = type(end_line) == 'number' and end_line or -1
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    local tick = api.nvim_buf_get_var(bufnr, 'changedtick')
    if type(changedtick) == 'number' and changedtick ~= tick then
      return
    end
    api.nvim_buf_clear_namespace(bufnr, ns, start_line, end_line)
    addHighlightTimer(bufnr, ns, highlights, priority, tick)
  end
end

-- Update namespace highlights of whole buffer.
-- @param bufnr - buffer number.
-- @param key - namespace id or key string.
-- @param highlights - highlight items, item could be HighlightItem dict or number list.
-- @param priority - optional priority.
-- @param changedtick - optional buffer changedtick.
function M.buffer_update(bufnr, key, highlights, priority, changedtick)
  if api.nvim_buf_is_loaded(bufnr) then
    local ns = create_namespace(key)
    api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
    if #highlights > 0 then
      local tick = api.nvim_buf_get_var(bufnr, 'changedtick')
      if type(changedtick) ~= 'number' or tick == changedtick then
        local winid = vim.fn.bufwinid(bufnr)
        if winid == -1 then
          addHighlightTimer(bufnr, ns, highlights, priority, tick)
        else
          local info = vim.fn.getwininfo(winid)[1]
          local topline = info.topline
          local botline = info.botline
          if topline <= 5 then
            addHighlightTimer(bufnr, ns, highlights, priority, tick)
          else
            local curr_hls = {}
            local other_hls = {}
            for _, hl in ipairs(highlights) do
              local lnum = hl[2] ~= nil and hl[2] + 1 or hl.lnum + 1
              if lnum >= topline and lnum <= botline then
                table.insert(curr_hls, hl)
              else
                table.insert(other_hls, hl)
              end
            end
            vim.list_extend(curr_hls, other_hls)
            addHighlightTimer(bufnr, ns, curr_hls, priority, tick)
          end
        end
      end
    end
  end
end

-- Add highlights to LSP ranges
-- @param id - buffer number or 0 for current buffer.
-- @param key - namespace id or key string.
-- @param hl_group - highlight group.
-- @param ranges - LSP range list.
-- @param opts - Optional table with priority and clear, combine as boolean.
function M.highlight_ranges(id, key, hl_group, ranges, opts)
  local bufnr = id == 0 and api.nvim_get_current_buf() or id
  if is_null(opts) or type(opts) ~= 'table' then
    opts = {}
  end
  if api.nvim_buf_is_loaded(bufnr) then
    if opts.clear then
      local ns = create_namespace(key)
      api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
    end
    local highlights = {}
    for _, range in ipairs(ranges) do
      local sp = range['start']
      local ep = range['end']
      local lines = vim.fn.getbufline(bufnr, sp.line + 1, ep.line + 1)
      for index=sp.line,ep.line,1 do
        local line = lines[index - sp.line + 1] or ''
        if #line > 0 then
          local colStart = index == sp.line and byte_index(line, sp.character) or 0
          local colEnd = index == ep.line and byte_index(line, ep.character) or #line
          if colEnd > colStart then
            local combine = is_enabled(opts.combine) and 1 or 0
            table.insert(highlights, {hl_group, index, colStart, colEnd, combine, opts.start_incl, opts.end_incl})
          end
        end
      end
    end
    if #highlights > 0 then
      local priority = type(opts.priority) == 'number' and opts.priority or 4096
      M.set_highlights(bufnr, key, highlights, priority)
    end
  end
end

-- Use matchaddpos to add highlights to window.
-- @param id - window id, or 0 for current window.
-- @param buf - buffer number, or 0 for current buffer.
-- @param ranges - LSP ranges.
-- @param hlGroup - highlight group.
-- @param priority - Optional priority, default to 99.
function M.match_ranges(id, buf, ranges, hl_group, priority)
  local winid = id == 0 and api.nvim_get_current_win() or id
  local bufnr = buf == 0 and vim.fn.winbufnr(winid) or buf
  if not api.nvim_win_is_valid(winid) or vim.fn.winbufnr(winid) ~= bufnr then
    return {}
  end
  local ids = {}
  local pos = {}
  for _, range in ipairs(ranges) do
    local sp = range['start']
    local ep = range['end']
    local lines = vim.fn.getbufline(bufnr, sp.line + 1, ep.line + 1)
    for index=sp.line,ep.line,1 do
      local line = lines[index - sp.line + 1] or ''
      if #line > 0 then
        local colStart = index == sp.line and byte_index(line, sp.character) or 0
        local colEnd = index == ep.line and byte_index(line, ep.character) or #line
        if colEnd > colStart then
          table.insert(pos, {index + 1, colStart + 1, colEnd - colStart})
        end
      end
    end
  end
  local count = #pos
  if count > 0 then
    priority = type(priority) == 'number' and priority or 99
    local opts = {window = winid}
    if count < 9 or n10 then
      ---@diagnostic disable-next-line: param-type-mismatch
      table.insert(ids, vim.fn.matchaddpos(hl_group, pos, priority, -1, opts))
    else
      local group = {}
      for i=1,count,8 do
        for j = i,math.min(i+7, count) do
          table.insert(group, pos[j])
        end
        ---@diagnostic disable-next-line: param-type-mismatch
        table.insert(ids, vim.fn.matchaddpos(hl_group, group, priority, -1, opts))
        group = {}
      end
    end
  end
  return ids
end

return M
