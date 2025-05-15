vim9script

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
  def Lcs(a: string, b: string): string
    var matrix = []
    for i in range(0, strchars(a))
      matrix[i] = []
      for j in range(0, strchars(b))
        if i == 0 || j == 0
          matrix[i][j] = 0
        elseif a[i] == b[j]
          matrix[i][j] = matrix[i - 1][j - 1] + 1
        else
          matrix[i][j] = max([matrix[i - 1][j], matrix[i][j - 1]])
        endif
      endfor
    endfor
    var result = ''
    var i = strchars(a) - 1
    var j = strchars(b) - 1
    while i >= 0 && j >= 0
      if a[i] == b[j]
        result = a[i] .. result
        i -= 1
        j -= 1
      elseif matrix[i - 1][j] > matrix[i][j - 1]
        i -= 1
      else
        j -= 1
      endif
    endwhile
    return result
  enddef
  const len1 = strchars(str1)
  const len2 = strchars(str2)
  var common = Lcs(str1, str2)
  var result = []
  var i1 = 0
  var i2 = 0
  var ic = 0
  while ic < strchars(common)
    # 处理str1中不在公共序列的部分
    while i1 < len1 && str1[i1] != common[ic]
      result->add({type: '-', char: str1[i1]})
      i1 += 1
    endwhile
    # 处理str2中不在公共序列的部分
    while i2 < len2 && str2[i2] != common[ic]
      result->add({type: '+', char: str2[i2]})
      i2 += 1
    endwhile
    # 添加公共字符
    if ic < strchars(common)
      result->add({type: '=', char: common[ic]})
      i1 += 1
      i2 += 1
      ic += 1
    endif
  endwhile
  # 处理剩余字符
  while i1 < len1
    result->add({type: '-', char: str1[i1]})
    i1 += 1
  endwhile
  while i2 < len2
    result->add({type: '+', char: str2[i2]})
    i2 += 1
  endwhile
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
    const max = old_length - prefixLen - suffixLen
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
  const oldText = old_length == suffixLen ? '' : Slice(oldStr, prefixLen, old_length - suffixLen)
  echo suffixLen
  return {
    oldStart: prefixLen,
    oldEnd: endIndex,
    oldText: oldText,
    newText: Slice(newStr, prefixLen, new_length - suffixLen),
  }
enddef

# 0 based start_col and end_col
export def SimpleApplyDiff(text: string, start_col: number, end_col: number, insert: string): string
  const prefix = start_col > 0 ? strpart(text, 0, start_col) : ''
  const suffix = end_col < len(text) ? strpart(text, end_col) : ''
  return prefix .. insert .. suffix
enddef

# Apply change from original to current for newText
export def DiffApply(original: string, current: string, newText: string, colIdx: number): any
  const charIdx = colIdx == -1 ? -1 : Char_index(current, colIdx)
  const diff = SimpleStringDiff(original, current, charIdx)
  const delta = diff.oldEnd - diff.oldStart

  var newIdx = FindCorrespondingPosition(original, newText, diff.oldStart)
  if newIdx == -1
    return null
  endif
  if delta == 0
    return SimpleApplyDiff(newText, newIdx, newIdx, diff.newText)
  endif
  # Should remove same text
  if newText[newIdx : newIdx + delta] !=# diff.oldText
    return null
  endif
  return SimpleApplyDiff(newText, newIdx, newIdx + delta, diff.newText)
enddef
