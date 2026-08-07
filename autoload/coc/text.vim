vim9script

# LCS is O(n * m), limit three-way merge to reasonable line lengths
const max_merge_len = 200

export def LinesEqual(one: list<string>, two: list<string>): bool
  if len(one) != len(two)
    return false
  endif
  for i in range(0, len(one) - 1)
    if one[i] !=# two[i]
      return false
    endif
  endfor
  return true
enddef

# Slice like javascript by character index
export def Slice(str: string, start_idx: number, end_idx: any = null): string
  if end_idx == null
    return str[start_idx : ]
  endif
  if start_idx >= end_idx
    return ''
  endif
  return str[start_idx : end_idx - 1]
enddef

# Function to check if a string starts with a given prefix
export def StartsWith(str: string, prefix: string): bool
  return str =~# '^' .. prefix
enddef

# Function to check if a string ends with a given suffix
export def EndsWith(str: string, suffix: string): bool
  return str =~# suffix .. '$'
enddef

# UTF16 character index in line to byte index.
export def Byte_index(line: string, character: number): number
  if character == 0
    return 0
  endif
  var i = 0
  var len = 0
  for char in split(line, '\zs')
    i += char2nr(char) > 65535 ? 2 : 1
    len += strlen(char)
    if i >= character
      break
    endif
  endfor
  return len
enddef

# Character index of current vim encoding.
export def Char_index(line: string, colIdx: number): number
  return strpart(line, 0, colIdx)->strchars()
enddef

# Using character indexes
export def LcsDiff(str1: string, str2: string): list<dict<any>>
  const chars1 = split(str1, '\zs')
  const chars2 = split(str2, '\zs')
  const len1 = len(chars1)
  const len2 = len(chars2)
  # Trim common prefix and suffix, LCS only on the changed middle
  var start = 0
  while start < len1 && start < len2 && chars1[start] == chars2[start]
    start += 1
  endwhile
  var end1 = len1
  var end2 = len2
  while end1 > start && end2 > start && chars1[end1 - 1] == chars2[end2 - 1]
    end1 -= 1
    end2 -= 1
  endwhile
  const mid1 = start == end1 ? [] : chars1[start : end1 - 1]
  const mid2 = start == end2 ? [] : chars2[start : end2 - 1]
  def Lcs(a: list<string>, b: list<string>): list<string>
    var matrix: list<list<number>> = []
    for i in range(0, len(a))
      matrix[i] = []
      for j in range(0, len(b))
        if i == 0 || j == 0
          matrix[i][j] = 0
        elseif a[i - 1] == b[j - 1]
          matrix[i][j] = matrix[i - 1][j - 1] + 1
        else
          matrix[i][j] = max([matrix[i - 1][j], matrix[i][j - 1]])
        endif
      endfor
    endfor
    var result: list<string> = []
    var i = len(a)
    var j = len(b)
    while i > 0 && j > 0
      if a[i - 1] == b[j - 1]
        result->add(a[i - 1])
        i -= 1
        j -= 1
      elseif matrix[i - 1][j] > matrix[i][j - 1]
        i -= 1
      else
        j -= 1
      endif
    endwhile
    result->reverse()
    return result
  enddef
  var common = Lcs(mid1, mid2)
  var result: list<dict<any>> = []
  for i in range(0, start - 1)
    result->add({type: '=', char: chars1[i]})
  endfor
  var i1 = 0
  var i2 = 0
  var ic = 0
  while ic < len(common)
    # 处理str1中不在公共序列的部分
    while i1 < len(mid1) && mid1[i1] != common[ic]
      result->add({type: '-', char: mid1[i1]})
      i1 += 1
    endwhile
    # 处理str2中不在公共序列的部分
    while i2 < len(mid2) && mid2[i2] != common[ic]
      result->add({type: '+', char: mid2[i2]})
      i2 += 1
    endwhile
    # 添加公共字符
    result->add({type: '=', char: common[ic]})
    i1 += 1
    i2 += 1
    ic += 1
  endwhile
  # 处理剩余字符
  while i1 < len(mid1)
    result->add({type: '-', char: mid1[i1]})
    i1 += 1
  endwhile
  while i2 < len(mid2)
    result->add({type: '+', char: mid2[i2]})
    i2 += 1
  endwhile
  for i in range(end1, len1 - 1)
    result->add({type: '=', char: chars1[i]})
  endfor
  return result
enddef

# Extract changed segments from a diff, segment is {start, end, text},
# start/end are character indexes of the first string.
def GetSegments(diff: list<dict<any>>): list<dict<any>>
  var segs: list<dict<any>> = []
  var start = -1
  var i1 = 0
  var buf = ''
  for item in diff
    if item.type ==# '='
      if start >= 0
        segs->add({start: start, end: i1, text: buf})
        start = -1
        buf = ''
      endif
      i1 += 1
    elseif item.type ==# '-'
      if start < 0
        start = i1
      endif
      i1 += 1
    else
      if start < 0
        start = i1
      endif
      buf ..= item.char
    endif
  endfor
  if start >= 0
    segs->add({start: start, end: i1, text: buf})
  endif
  return segs
enddef

# Three-way merge of a line by character, user text wins on conflicts.
# Insertions at the boundary of a changed segment are kept.
# Returns the user text when the line is too long to merge.
def MergeLine(base: string, ours: string, theirs: string): any
  if ours ==# base
    return theirs
  endif
  if theirs ==# base || ours ==# theirs
    return ours
  endif
  const baseLen = strchars(base)
  if baseLen > max_merge_len || strchars(ours) > max_merge_len || strchars(theirs) > max_merge_len
    return ours
  endif
  const d1 = LcsDiff(base, ours)
  const d2 = LcsDiff(base, theirs)
  var all: list<dict<any>> = []
  for seg in GetSegments(d1)
    all->add({start: seg.start, end: seg.end, text: seg.text, side: 1})
  endfor
  for seg in GetSegments(d2)
    all->add({start: seg.start, end: seg.end, text: seg.text, side: 2})
  endfor
  if len(all) == 0
    return ours
  endif
  all->sort((a, b) => a.start == b.start ? a.end - b.end : a.start - b.start)
  var groups: list<dict<any>> = []
  for seg in all
    if len(groups) == 0
      groups->add({start: seg.start, end: seg.end, ours: seg.side == 1 ? [seg] : [], theirs: seg.side == 2 ? [seg] : []})
      continue
    endif
    var last = groups[-1]
    # Segments conflict when their ranges intersect, insertions at the
    # boundary of a changed segment are kept.
    var overlap = false
    if seg.start == seg.end
      overlap = seg.start > last.start && seg.start < last.end
    else
      overlap = seg.start < last.end && last.start < seg.end
    endif
    if overlap
      if seg.side == 1
        add(last.ours, seg)
      else
        add(last.theirs, seg)
      endif
      last.end = max([last.end, seg.end])
    else
      groups->add({start: seg.start, end: seg.end, ours: seg.side == 1 ? [seg] : [], theirs: seg.side == 2 ? [seg] : []})
    endif
  endfor
  var result = ''
  var pos = 0
  for group in groups
    if group.start > pos
      result ..= strcharpart(base, pos, group.start - pos)
      pos = group.start
    endif
    # Conflict, apply user changes only.
    var segs = len(group.ours) > 0 ? group.ours : group.theirs
    var gpos = group.start
    for seg in segs
      if seg.start > gpos
        result ..= strcharpart(base, gpos, seg.start - gpos)
      endif
      result ..= seg.text
      gpos = seg.end
    endfor
    if group.end > gpos
      result ..= strcharpart(base, gpos, group.end - gpos)
    endif
    pos = group.end
  endfor
  if pos < baseLen
    result ..= strcharpart(base, pos)
  endif
  return result
enddef

# Get the single changed part, by character index of cursor.
def SimpleStringDiff(oldStr: string, newStr: string, charIdx: number = -1): dict<any>
  var suffixLen = 0
  const old_length = strchars(oldStr)
  const new_length = strchars(newStr)
  var maxSuffixLen = 0
  if charIdx >= 0
    maxSuffixLen = min([old_length, new_length - charIdx])
    while suffixLen < maxSuffixLen
      if strcharpart(oldStr, old_length - suffixLen - 1, 1) !=
         strcharpart(newStr, new_length - suffixLen - 1, 1)
        break
      endif
      suffixLen += 1
    endwhile
  else
    maxSuffixLen = min([old_length, new_length])
    while suffixLen < maxSuffixLen
      if strcharpart(oldStr, old_length - suffixLen - 1, 1) !=
         strcharpart(newStr, new_length - suffixLen - 1, 1)
        break
      endif
      suffixLen += 1
    endwhile
  endif
  var prefixLen = 0
  var remainingLen = min([old_length - suffixLen, new_length - suffixLen])
  while prefixLen < remainingLen
    if strcharpart(oldStr, prefixLen, 1) != strcharpart(newStr, prefixLen, 1)
      break
    endif
    prefixLen += 1
  endwhile
  # Reduce suffixLen
  if suffixLen == new_length - charIdx
    const max = min([old_length, new_length]) - prefixLen - suffixLen
    var i = 0
    while i < max
      if strcharpart(oldStr, old_length - suffixLen - 1, 1) !=
         strcharpart(newStr, new_length - suffixLen - 1, 1)
        break
      endif
      suffixLen += 1
      i += 1
    endwhile
  endif
  const endIndex = old_length - suffixLen
  return {
    oldStart: prefixLen,
    oldEnd: endIndex,
    newText: Slice(newStr, prefixLen, new_length - suffixLen),
  }
enddef

# Search for new start position of diff in new string
export def SearchChangePosition(newStr: string, oldStr: string, diff: dict<any>): number
  var result = -1
  const delta = diff.oldEnd - diff.oldStart
  const oldText = Slice(oldStr, diff.oldStart, diff.oldEnd)
  def CheckPosition(idx: number): bool
    if delta == 0 || Slice(newStr, idx, idx + delta) ==# oldText
      result = idx
      return true
    endif
    return false
  enddef
  if Slice(oldStr, 0, diff.oldStart) ==# Slice(newStr, 0, diff.oldStart) && CheckPosition(diff.oldStart)
    return result
  endif
  # Insertion at the end of the old line maps to the end of the new line
  if delta == 0 && diff.oldStart == strchars(oldStr)
    return strchars(newStr)
  endif
  const diffs = LcsDiff(oldStr, newStr)
  # oldStr index
  var used = 0
  # newStr index
  var index = 0
  # Until used reached diff.oldStart
  var i = 0
  for d in diffs
    if d.type ==# '-'
      used += 1
    elseif d.type ==# '+'
      index += 1
    else
      used += 1
      index += 1
    endif
    if used == diff.oldStart && CheckPosition(index)
      break
    endif
  endfor
  return result
enddef

# 0 based start index and end index
export def SimpleApplyDiff(text: string, startIdx: number, endIdx: number, insert: string): string
  return Slice(text, 0, startIdx) .. insert .. Slice(text, endIdx)
enddef

# Apply change from original to current for newText
export def DiffApply(original: string, current: string, newText: string, colIdx: number): any
  if original ==# current
    return newText
  endif
  const charIdx = colIdx == -1 ? -1 : Char_index(current, colIdx)
  const diff = SimpleStringDiff(original, current, charIdx)
  const delta = diff.oldEnd - diff.oldStart
  const idx = SearchChangePosition(newText, original, diff)
  if idx != -1
    return SimpleApplyDiff(newText, idx, idx + delta, diff.newText)
  endif
  # Single change heuristic failed, use three-way merge as fallback.
  return MergeLine(original, current, newText)
enddef
