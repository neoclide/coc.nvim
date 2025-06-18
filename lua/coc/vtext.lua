local api = vim.api
local M = {}
local n10 = vim.fn.has('nvim-0.10')
local maxCount = vim.g.coc_highlight_maximum_count or 500

local function addVirtualText(bufnr, ns, opts, pre, priority)
    local align = opts.text_align or 'after'
    local config = { hl_mode = opts.hl_mode or 'combine' }
    local column = opts.col or 0
    if align == 'above' or align == 'below' then
      if #pre == 0 then
        config.virt_lines = { opts.blocks }
      else
        local list =  { {pre, 'Normal'}}
        vim.list_extend(list, opts.blocks)
        config.virt_lines = { list }
      end
      if align == 'above' then
        config.virt_lines_above = true
      end
    else
      config.virt_text = opts.blocks
      if n10 and column ~= 0 then
        config.virt_text_pos = 'inline'
      elseif align == 'right' then
        config.virt_text_pos = 'right_align'
      elseif type(opts.virt_text_win_col) == 'number' then
        config.virt_text_win_col = opts.virt_text_win_col
        config.virt_text_pos = 'overlay'
      elseif align == 'overlay' then
        config.virt_text_pos = 'overlay'
      else
        config.virt_text_pos = 'eol'
      end
      if type(opts.virt_lines) == 'table' then
        config.virt_lines = opts.virt_lines
        config.virt_text_pos = 'overlay'
      end
    end
    if type(priority) == 'number' then
      config.priority = math.min(priority, 4096)
    end
    local col = column ~= 0 and column - 1 or 0
    -- api.nvim_buf_set_extmark(bufnr, ns, opts.line, col, config)
    -- Error: col value outside range
    pcall(api.nvim_buf_set_extmark, bufnr, ns, opts.line, col, config)
end

-- This function is called by buffer.setVirtualText
function M.add(bufnr, ns, line, blocks, opts)
  local pre = ''
  if opts.indent == true then
    local str = vim.fn.getbufline(bufnr, line + 1)[1] or ''
    pre = string.match(str, "^%s*") or ''
  end
  local conf = {line = line, blocks = blocks}
  for key, value in pairs(opts) do
    conf[key] = value
  end
  addVirtualText(bufnr, ns, conf, pre, opts.priority)
end

-- opts.line - Zero based line number
-- opts.blocks - List with [text, hl_group]
-- opts.hl_mode - Default to 'combine'.
-- opts.col - nvim >= 0.10.0, 1 based.
-- opts.virt_text_win_col
-- opts.text_align - Could be 'after' 'right' 'below' 'above', converted on neovim.
-- indent - add indent when using 'above' and 'below' as text_align
local function addVirtualTexts(bufnr, ns, items, indent, priority)
  if #items == 0 then
    return nil
  end
  local buflines = {}
  local start = 0
  if indent then
    start = items[1].line
    local endLine = items[#items].line
    buflines = api.nvim_buf_get_lines(bufnr, start, endLine + 1, false) or {}
  end
  for _, opts in ipairs(items) do
    local pre = indent and string.match(buflines[opts.line - start + 1], "^%s*") or ''
    addVirtualText(bufnr, ns, opts, pre, priority)
  end
end

local function addVirtualTextsTimer(bufnr, ns, items, indent, priority, changedtick)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  if vim.fn.getbufvar(bufnr, 'changedtick', 0) ~= changedtick then
    return nil
  end
  if #items > maxCount then
    local markers = {}
    local next = {}
    vim.list_extend(markers, items, 1, maxCount)
    vim.list_extend(next, items, maxCount, #items)
    addVirtualTexts(bufnr, ns, markers, indent, priority)
    vim.defer_fn(function()
      addVirtualTextsTimer(bufnr, ns, next, indent, priority, changedtick)
    end, 10)
  else
    addVirtualTexts(bufnr, ns, items, indent, priority)
  end
end

function M.set(bufnr, ns, items, indent, priority)
  local changedtick = vim.fn.getbufvar(bufnr, 'changedtick', 0)
  addVirtualTextsTimer(bufnr, ns, items, indent, priority, changedtick)
end
return M
