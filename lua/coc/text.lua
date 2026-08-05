local api = vim.api

local M = {}

-- LCS is O(n * m), limit three-way merge to reasonable line lengths
local MAX_MERGE_LEN = 200

local function splitText(text, col)
  return text:sub(1, col - 1), text:sub(col)
end

local function copy(t)
  local list = {}
  for k, v in pairs(t) do
    list[k] = v
  end
  return list
end

local function insertList(target, insert, linePos, colPos)
  local result = {}
  for i = 1, #target do
    if i < linePos or i > linePos then
      table.insert(result, target[i])
    else
      local before, after = splitText(target[i], colPos)
      for j = 1, #insert do
        local text = insert[j]
        if j == 1 then
          text = before .. text
        end
        if j == #insert then
          text = text .. after
        end
        table.insert(result, text)
      end
    end
  end
  return result
end


local function lcsDiff(str1, str2) -- 计算最长公共子序列
  local function lcs(a, b)
    local matrix = {}
    for i = 0, #a do
      matrix[i] = {}
      for j = 0, #b do
        if i == 0 or j == 0 then
          matrix[i][j] = 0
        elseif a:sub(i, i) == b:sub(j, j) then
          matrix[i][j] = matrix[i - 1][j - 1] + 1
        else
          matrix[i][j] = math.max(matrix[i - 1][j], matrix[i][j - 1])
        end
      end
    end

    local result = ''
    local i, j = #a, #b
    while i > 0 and j > 0 do
      if a:sub(i, i) == b:sub(j, j) then
        result = a:sub(i, i) .. result
        i = i - 1
        j = j - 1
      elseif matrix[i - 1][j] > matrix[i][j - 1] then
        i = i - 1
      else
        j = j - 1
      end
    end

    return result
  end

  local common = lcs(str1, str2)
  local result = {}
  local i1, i2, ic = 1, 1, 1

  while ic <= #common do
    -- 处理str1中不在公共序列的部分
    while i1 <= #str1 and str1:sub(i1, i1) ~= common:sub(ic, ic) do
      table.insert(result, { type = '-', char = str1:sub(i1, i1) })
      i1 = i1 + 1
    end

    -- 处理str2中不在公共序列的部分
    while i2 <= #str2 and str2:sub(i2, i2) ~= common:sub(ic, ic) do
      table.insert(result, { type = '+', char = str2:sub(i2, i2) })
      i2 = i2 + 1
    end

    -- 添加公共字符
    if ic <= #common then
      table.insert(result, { type = '=', char = common:sub(ic, ic) })
      i1 = i1 + 1
      i2 = i2 + 1
      ic = ic + 1
    end
  end

  -- 处理剩余字符
  while i1 <= #str1 do
    table.insert(result, { type = '-', char = str1:sub(i1, i1) })
    i1 = i1 + 1
  end

  while i2 <= #str2 do
    table.insert(result, { type = '+', char = str2:sub(i2, i2) })
    i2 = i2 + 1
  end
  return result
end

-- Try find new col in changed text
-- Not 100% correct, but works most of the time.
-- Return nil when not found
local function findNewCol(text, col, newText)
  local before, after = splitText(text, col)
  if #before == 0 then
    return 1
  end
  if #after == 0 then
    return #newText + 1
  end
  if #before <= #after and string.sub(newText, 1, #before) == before then
    return col
  end
  if string.sub(newText, -#after) == after then
    return #newText - #after + 1
  end
  local diff = lcsDiff(text, newText)
  local used = 1
  local index = 1
  for _, item in ipairs(diff) do
    if item.type == '-' then
      used = used + #item.char
    elseif item.type == '+' then
      index = index + #item.char
    elseif item.type == '=' then
      local total = used + #item.char
      if total >= col then
        local plus = col - used
        used = col
        index = index + plus
      else
        used = total
        index = index + #item.char
      end
    end
    if used == col then
      break
    end
    if used > col then
      return nil
    end
  end
  return used == col and index or nil
end

local function findInsert(arr1, arr2, linePos, colPos)
  local l1 = #arr1
  local l2 = #arr2
  if l1 < l2 or linePos < 1 or linePos > #arr1 then
    return nil
  end
  arr2 = copy(arr2)
  for i = 1, #arr1 - linePos, 1 do
    local a = arr1[l1 - i + 1]
    local idx = l2 - i + 1
    local b = arr2[idx]
    if b == nil then
      return nil
    end
    if a ~= b then
      return nil
    end
    table.remove(arr2, idx)
  end
  local before, after = splitText(arr1[linePos], colPos)
  local last = arr2[#arr2]
  if #after > 0 and last:sub(-#after) ~= after then
    return nil
  end
  arr2[#arr2] = last:sub(1, - #after - 1)
  for index, value in ipairs(arr2) do
    local text = arr1[index]
    if index < #arr2 and text ~= value then
      return nil
    end
    if index == #arr2 and text:sub(1, #value) ~= value then
      return nil
    end
  end
  local pos = {}
  pos.line = #arr2
  pos.col = #(arr2[#arr2]) + 1
  local inserted = {}
  for i = pos.line, linePos, 1 do
    if i == pos.line then
      local text = arr1[i]:sub(pos.col)
      table.insert(inserted, text)
    elseif i == linePos then
      table.insert(inserted, before)
    else
      table.insert(inserted, arr1[i])
    end
  end
  return pos, inserted
end

local function findStringDiff(oldStr, newStr, reverseFirst)
    local len1, len2 = #oldStr, #newStr
    local maxLen = math.max(len1, len2)
    -- 先从后往前找差异
    if reverseFirst then
        local end1, end2 = len1, len2
        while end1 >= 1 and end2 >= 1 do
            local c1 = oldStr:sub(end1, end1)
            local c2 = newStr:sub(end2, end2)
            if c1 ~= c2 then
                break
            end
            end1 = end1 - 1
            end2 = end2 - 1
        end
        -- 如果完全相同
        if end1 < 1 and end2 < 1 then
            return nil
        end

        -- 然后从前往后找差异
        local start = 1
        while start <= end1 and start <= end2 do
            local c1 = oldStr:sub(start, start)
            local c2 = newStr:sub(start, start)
            if c1 ~= c2 then
                break
            end
            start = start + 1
        end
        return {
            startPos = start,
            endPosOld = end1,
            inserted = newStr:sub(start, end2)
        }
    else
        local start = 1
        while start <= maxLen do
            local c1 = start <= len1 and oldStr:sub(start, start) or nil
            local c2 = start <= len2 and newStr:sub(start, start) or nil
            if c1 ~= c2 then
                break
            end
            start = start + 1
        end
        -- 如果完全相同
        if start > maxLen then
            return nil
        end
        -- 然后从后往前找差异
        local end1, end2 = len1, len2
        while end1 >= start and end2 >= start do
            local c1 = oldStr:sub(end1, end1)
            local c2 = newStr:sub(end2, end2)
            if c1 ~= c2 then
                break
            end
            end1 = end1 - 1
            end2 = end2 - 1
        end
        return {
            startPos = start,
            endPosOld = end1,
            inserted = newStr:sub(start, end2)
        }
    end
end

local function replaceSubstring(original, startPos, endPos, replacement)
    local prefix = original:sub(1, startPos - 1)
    local suffix = original:sub(endPos + 1)
    return prefix .. replacement .. suffix
end

local function hasConflict(diff1, diff2)
    -- 如果任一diff为nil（无变化），则无冲突
    if not diff1 or not diff2 then
        return false
    end
    -- 获取两个diff的修改范围
    local start1, end1 = diff1.startPos, diff1.endPosOld
    local start2, end2 = diff2.startPos, diff2.endPosOld
    -- 处理删除的情况（endPos可能小于startPos）
    end1 = math.max(end1, start1 - 1)
    end2 = math.max(end2, start2 - 1)
    -- 检查范围是否重叠
    local overlap = not (end1 < start2 or end2 < start1)
    return overlap
end

local function diffApply(original, current, newText, reverseFirst)
  local diff1 = findStringDiff(original, current, reverseFirst)
  local diff2 = findStringDiff(original, newText, not reverseFirst)
  if hasConflict(diff1, diff2) then
     diff1 = findStringDiff(original, current, not reverseFirst)
     diff2 = findStringDiff(original, newText, reverseFirst)
  end
  if diff1 == nil or diff2 == nil or hasConflict(diff1, diff2) then
    return nil
  end
  local result
  if diff1.startPos < diff2.startPos then
    result = replaceSubstring(original, diff2.startPos, diff2.endPosOld, diff2.inserted)
    result = replaceSubstring(result, diff1.startPos, diff1.endPosOld, diff1.inserted)
  else
    result = replaceSubstring(original, diff1.startPos, diff1.endPosOld, diff1.inserted)
    result = replaceSubstring(result, diff2.startPos, diff2.endPosOld, diff2.inserted)
  end
  return result
end

-- Character list of a string, matches strchars() semantics
local function toChars(text)
  return vim.fn.split(text, '\\zs')
end

-- Character based LCS diff of two strings, returns {type, char} items
local function charLcsDiff(str1, str2)
  local chars1 = toChars(str1)
  local chars2 = toChars(str2)
  local n1, n2 = #chars1, #chars2
  -- Trim common prefix and suffix, LCS only on the changed middle
  local start = 1
  while start <= n1 and start <= n2 and chars1[start] == chars2[start] do
    start = start + 1
  end
  local end1, end2 = n1, n2
  while end1 >= start and end2 >= start and chars1[end1] == chars2[end2] do
    end1 = end1 - 1
    end2 = end2 - 1
  end
  local function slice(list, from, to)
    local result = {}
    for i = from, to do
      result[#result + 1] = list[i]
    end
    return result
  end
  local mid1 = slice(chars1, start, end1)
  local mid2 = slice(chars2, start, end2)
  local matrix = {}
  for i = 0, #mid1 do
    matrix[i] = {}
    for j = 0, #mid2 do
      if i == 0 or j == 0 then
        matrix[i][j] = 0
      elseif mid1[i] == mid2[j] then
        matrix[i][j] = matrix[i - 1][j - 1] + 1
      else
        matrix[i][j] = math.max(matrix[i - 1][j], matrix[i][j - 1])
      end
    end
  end
  local common = {}
  local i, j = #mid1, #mid2
  while i > 0 and j > 0 do
    if mid1[i] == mid2[j] then
      common[#common + 1] = mid1[i]
      i = i - 1
      j = j - 1
    elseif matrix[i - 1][j] > matrix[i][j - 1] then
      i = i - 1
    else
      j = j - 1
    end
  end
  for k = 1, math.floor(#common / 2) do
    common[k], common[#common - k + 1] = common[#common - k + 1], common[k]
  end
  local result = {}
  for i = 1, start - 1 do
    table.insert(result, { type = '=', char = chars1[i] })
  end
  local i1, i2, ic = 1, 1, 1
  while ic <= #common do
    while i1 <= #mid1 and mid1[i1] ~= common[ic] do
      table.insert(result, { type = '-', char = mid1[i1] })
      i1 = i1 + 1
    end
    while i2 <= #mid2 and mid2[i2] ~= common[ic] do
      table.insert(result, { type = '+', char = mid2[i2] })
      i2 = i2 + 1
    end
    table.insert(result, { type = '=', char = common[ic] })
    i1 = i1 + 1
    i2 = i2 + 1
    ic = ic + 1
  end
  while i1 <= #mid1 do
    table.insert(result, { type = '-', char = mid1[i1] })
    i1 = i1 + 1
  end
  while i2 <= #mid2 do
    table.insert(result, { type = '+', char = mid2[i2] })
    i2 = i2 + 1
  end
  for i = end1 + 1, n1 do
    table.insert(result, { type = '=', char = chars1[i] })
  end
  return result
end

-- Extract changed segments from a diff, segment is {start, finish, text},
-- start/finish are 0 based character indexes of the first string.
local function getSegments(diff)
  local segs = {}
  local start = -1
  local i1 = 0
  local buf = {}
  local function flush()
    if start >= 0 then
      table.insert(segs, { start = start, finish = i1, text = table.concat(buf) })
      start = -1
      buf = {}
    end
  end
  for _, item in ipairs(diff) do
    if item.type == '=' then
      flush()
      i1 = i1 + 1
    elseif item.type == '-' then
      if start < 0 then
        start = i1
      end
      i1 = i1 + 1
    else
      if start < 0 then
        start = i1
      end
      buf[#buf + 1] = item.char
    end
  end
  flush()
  return segs
end

-- Three-way merge of a line by character, user text wins on conflicts.
-- Insertions at the boundary of a changed segment are kept.
-- Returns nil when the line is too long to merge.
local function mergeLine(base, ours, theirs)
  if ours == base then
    return theirs
  end
  if theirs == base or ours == theirs then
    return ours
  end
  local baseLen = vim.fn.strchars(base)
  if baseLen > MAX_MERGE_LEN or vim.fn.strchars(ours) > MAX_MERGE_LEN or vim.fn.strchars(theirs) > MAX_MERGE_LEN then
    return nil
  end
  -- Byte offset of each character index, lua string operations are byte based
  local offsets = { 0 }
  for _, ch in ipairs(toChars(base)) do
    offsets[#offsets + 1] = offsets[#offsets] + #ch
  end
  local function bytePos(charIdx)
    return offsets[charIdx + 1]
  end
  local all = {}
  for _, seg in ipairs(getSegments(charLcsDiff(base, ours))) do
    table.insert(all, { start = seg.start, finish = seg.finish, byteStart = bytePos(seg.start), byteFinish = bytePos(seg.finish), text = seg.text, side = 1 })
  end
  for _, seg in ipairs(getSegments(charLcsDiff(base, theirs))) do
    table.insert(all, { start = seg.start, finish = seg.finish, byteStart = bytePos(seg.start), byteFinish = bytePos(seg.finish), text = seg.text, side = 2 })
  end
  if #all == 0 then
    return ours
  end
  table.sort(all, function(a, b)
    if a.start == b.start then
      return a.finish < b.finish
    end
    return a.start < b.start
  end)
  local groups = {}
  for _, seg in ipairs(all) do
    if #groups == 0 then
      table.insert(groups, {
        start = seg.start,
        finish = seg.finish,
        byteStart = seg.byteStart,
        byteFinish = seg.byteFinish,
        ours = seg.side == 1 and { seg } or {},
        theirs = seg.side == 2 and { seg } or {}
      })
    else
      local last = groups[#groups]
      -- Segments conflict when their ranges intersect, insertions at the
      -- boundary of a changed segment are kept.
      local overlap
      if seg.start == seg.finish then
        overlap = seg.start > last.start and seg.start < last.finish
      else
        overlap = seg.start < last.finish and last.start < seg.finish
      end
      if overlap then
        local target = seg.side == 1 and last.ours or last.theirs
        table.insert(target, seg)
        last.finish = math.max(last.finish, seg.finish)
        last.byteFinish = math.max(last.byteFinish, seg.byteFinish)
      else
        table.insert(groups, {
          start = seg.start,
          finish = seg.finish,
          byteStart = seg.byteStart,
          byteFinish = seg.byteFinish,
          ours = seg.side == 1 and { seg } or {},
          theirs = seg.side == 2 and { seg } or {}
        })
      end
    end
  end
  local result = {}
  local pos = 0
  for _, group in ipairs(groups) do
    if group.byteStart > pos then
      result[#result + 1] = base:sub(pos + 1, group.byteStart)
      pos = group.byteStart
    end
    -- Conflict, apply user changes only.
    local segs = #group.ours > 0 and group.ours or group.theirs
    local gpos = group.byteStart
    for _, seg in ipairs(segs) do
      if seg.byteStart > gpos then
        result[#result + 1] = base:sub(gpos + 1, seg.byteStart)
      end
      result[#result + 1] = seg.text
      gpos = seg.byteFinish
    end
    if group.byteFinish > gpos then
      result[#result + 1] = base:sub(gpos + 1, group.byteFinish)
    end
    pos = group.byteFinish
  end
  if pos < baseLen then
    result[#result + 1] = base:sub(pos + 1)
  end
  return table.concat(result)
end

-- Change single line by use nvim_buf_set_text
-- 1 based line number, current line, applied line
function M.changeLineText(bufnr, lnum, current, applied)
  local diff = findStringDiff(current, applied)
  if diff ~= nil then
    local lineIdx = lnum - 1
    api.nvim_buf_set_text(bufnr, lineIdx, diff.startPos - 1, lineIdx, diff.endPosOld, {diff.inserted})
  end
end

-- Check if new line insert.
-- Check text change instead of insert only.
-- Check change across multiple lines.
function M.set_lines(bufnr, changedtick, originalLines, replacement, startLine, endLine, changes, cursor, col, linecount)
  if not api.nvim_buf_is_loaded(bufnr) then
    return nil
  end
  local delta = 0
  local column = vim.fn.col('.')
  if type(col) == 'number' then
    delta = column  - col
  end
  local applied = nil
  local idx = 0
  local currentBuf = api.nvim_get_current_buf() == bufnr
  local current = currentBuf and vim.fn.getline('.') or ''
  if currentBuf and api.nvim_buf_get_var(bufnr, 'changedtick') > changedtick then
    local lnum = vim.fn.line('.')
    idx = lnum - startLine
    if idx >= 1 then
      local original = originalLines[idx]
      local count = vim.fn.line('$')
      if count ~= linecount then
        -- Check content insert before cursor.
        if count > linecount then
          local currentLines = api.nvim_buf_get_lines(bufnr, startLine, endLine + count - linecount, false)
          -- Cursor not inside
          if currentLines[idx] == nil then
            return nil
          end
          -- Compare to original lines, find insert position, text
          local pos, inserted = findInsert(currentLines, originalLines, idx, column)
          if pos ~= nil then
            local newText = replacement[pos.line]
            if newText == nil then
              return nil
            end
            local colPos = findNewCol(originalLines[pos.line], pos.col, newText)
            if colPos == nil then
              return nil
            end
            replacement = insertList(replacement, inserted, pos.line, colPos)
            endLine = endLine + count - linecount
            changes = vim.NIL
          else
            return nil
          end
        else
          return nil
        end
      else
        -- current line changed
        if original ~= nil and original ~= current then
          local newText = replacement[idx]
          if newText ~= nil then
            if newText == original then
              applied = current
            else
              applied = diffApply(original, current, newText, column > #current/2)
              if applied == nil then
                -- Fallback to three-way merge, keep user text when not possible
                applied = mergeLine(original, current, newText) or current
              end
            end
          end
        end
      end
    end
  end
  if applied ~= nil then
    replacement[idx] = applied
    if #replacement < 30 then
      -- use nvim_buf_set_text to keep extmarks
      for i = 1, math.min(#replacement, #originalLines) do
        local text = idx == i and current or originalLines[i]
        M.changeLineText(bufnr, startLine + i, text, replacement[i])
      end
      if #replacement > #originalLines then
        local newLines = vim.list_slice(replacement, #originalLines + 1)
        api.nvim_buf_set_lines(bufnr, endLine, endLine, false, newLines)
      elseif #originalLines > #replacement then
        api.nvim_buf_set_lines(bufnr, startLine + #replacement, endLine, false, {})
      end
    else
      api.nvim_buf_set_lines(bufnr, startLine, endLine, false, replacement)
    end
  else
    if type(changes) == 'table' and #changes > 0 then
      -- reverse iteration
      for i = #changes, 1, -1 do
        local item = changes[i]
        api.nvim_buf_set_text(bufnr, item[2], item[3], item[4], item[5], item[1])
      end
    else
      api.nvim_buf_set_lines(bufnr, startLine, endLine, false, replacement)
    end
  end
  if currentBuf and type(cursor) == 'table' then
    vim.fn.cursor({cursor[1], cursor[2] + delta})
  end
end

-- Merge helper exported for tests
M.mergeLine = mergeLine

return M
