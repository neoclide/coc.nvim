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

# Using character indexes
def LcsDiff(str1: string, str2: string): list<dict<any>>
  # 计算最长公共子序列
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

# Get the single changed part.
export def SimpleStringDiff(oldStr: string, newStr: string, col: number = -1): dict<any>
  var suffixLen = 0
  const old_length = len(oldStr)
  const new_length = len(newStr)
  if col >= 0
    var maxSuffixLen = min([old_length, new_length - col])
    while suffixLen < maxSuffixLen
      if strpart(oldStr, old_length - suffixLen - 1, 1) !=
         strpart(newStr, new_length - suffixLen - 1, 1)
        break
      endif
      suffixLen += 1
    endwhile
  else
    var maxSuffixLen = min([old_length, new_length])
    while suffixLen < maxSuffixLen
      if strpart(oldStr, old_length - suffixLen - 1, 1) !=
         strpart(newStr, new_length - suffixLen - 1, 1)
        break
      endif
      suffixLen += 1
    endwhile
  endif
  var prefixLen = 0
  var remainingLen = min([old_length - suffixLen, new_length - suffixLen])
  while prefixLen < remainingLen
    if strpart(oldStr, prefixLen, 1) != strpart(newStr, prefixLen, 1)
      break
    endif
    prefixLen += 1
  endwhile
  const colEnd = old_length - suffixLen
  const oldText = old_length == suffixLen ? '' : strpart(oldStr, prefixLen, old_length - prefixLen - suffixLen)
  return {
    oldStart: prefixLen,
    oldEnd: colEnd,
    oldText: oldText,
    newText: strpart(newStr, prefixLen, new_length - prefixLen - suffixLen)
  }
enddef

# 0 based start_col and end_col
export def SimpleApplyDiff(text: string, start_col: number, end_col: number, insert: string): string
  const prefix = start_col > 0 ? strpart(text, 0, start_col) : ''
  const suffix = end_col < len(text) ? strpart(text, end_col) : ''
  return prefix .. insert .. suffix
enddef

# Find possible new col index in new string.
export def FindCorrespondingPosition(oldStr: string, newStr: string, colIdx: number): number
  const old_len = len(oldStr)
  const new_len = len(newStr)
  if colIdx < 0 || colIdx > old_len
    return -1
  endif
  if oldStr ==# newStr
    return colIdx
  endif
  if colIdx == old_len
    return new_len
  endif
  if colIdx == 0
    return 0
  endif
  # 计算前后部分长度
  var prefixLen = colIdx
  var suffixLen = old_len - colIdx
  # 1. 优先比较较短的部分
  if prefixLen <= suffixLen
    # 先比较前缀部分
    var prefixMatchPos = MatchPrefixPart(oldStr, newStr, colIdx)
    if prefixMatchPos >= 0
      return prefixMatchPos
    endif
    # 前缀匹配失败再尝试后缀
    var suffixMatchPos = MatchSuffixPart(oldStr, newStr, colIdx)
    if suffixMatchPos >= 0
      return suffixMatchPos
    endif
  else
    # 先比较后缀部分
    var suffixMatchPos = MatchSuffixPart(oldStr, newStr, colIdx)
    if suffixMatchPos >= 0
      return suffixMatchPos
    endif

    # 后缀匹配失败再尝试前缀
    var prefixMatchPos = MatchPrefixPart(oldStr, newStr, colIdx)
    if prefixMatchPos >= 0
      return prefixMatchPos
    endif
  endif

  # 2. 如果前后匹配都失败，使用基于编辑距离的方法
  return FindByEditDistance(oldStr, newStr, colIdx)
enddef

def MatchPrefixPart(oldStr: string, newStr: string, colIdx: number): number
  var prefixLen = colIdx
  var oldPrefix = strpart(oldStr, 0, colIdx)
  var maxPossibleStart = len(newStr) - prefixLen
  # 从后往前找可以更快找到最近的匹配
  for start in range(maxPossibleStart, -1, -1)
    if strpart(newStr, start, prefixLen) == oldPrefix
      return start + min([colIdx, len(newStr) - start - 1])
    endif
  endfor
  return -1
enddef

def MatchSuffixPart(oldStr: string, newStr: string, colIdx: number): number
  var suffixLen = len(oldStr) - colIdx
  var oldSuffix = strpart(oldStr, colIdx)
  var maxPossibleStart = len(newStr) - suffixLen
  # 从前往后找可以更快找到最左的匹配
  for start in range(0, maxPossibleStart + 1)
    if strpart(newStr, start, suffixLen) == oldSuffix
      # 返回匹配开始位置加上原始偏移量
      var adjustedPos = start + (colIdx - (len(oldStr) - suffixLen))
      return max([0, min([adjustedPos, len(newStr) - 1])])
    endif
  endfor
  return -1
enddef

# Helper function to calculate the edit distance between two strings
def CalculateEditDistance(s1: string, s2: string): list<any>
  var len1: number = len(s1)
  var len2: number = len(s2)
  # Create a 2D array to store distances
  var dp: list<any> = []
  for i in range(len1 + 1)
    call add(dp, range(len2 + 1))
  endfor
  # Initialize the dp array
  for i in range(len1 + 1)
    dp[i][0] = i
  endfor
  for j in range(len2 + 1)
    dp[0][j] = j
  endfor
  # Fill the dp array
  for i in range(0, len1)
    for j in range(0, len2)
      if strpart(s1, i - 1, 1) ==# strpart(s2, j - 1, 1)
        dp[i][j] = dp[i - 1][j - 1]
      else
        dp[i][j] = min([dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]]) + 1
      endif
    endfor
  endfor
  return dp
enddef

def FindByEditDistance(oldStr: string, newStr: string, colIdx: number): number
  # Calculate the edit distance matrix
  var dp: list<any> = CalculateEditDistance(oldStr, newStr)
  # Backtrack to find the new column index
  var i: number = len(oldStr)
  var j: number = len(newStr)
  var newColIdx: number = colIdx
  while i > 0 && j > 0
    if oldStr[i - 1] ==# newStr[j - 1]
      if i == colIdx
        newColIdx = j
      endif
      i -= 1
      j -= 1
    elseif dp[i][j] == dp[i - 1][j - 1] + 1
      i -= 1
      j -= 1
    elseif dp[i][j] == dp[i - 1][j] + 1
      i -= 1
    else
      j -= 1
    endif
  endwhile
  return newColIdx
enddef

# Apply change from original to current for newText
export def DiffApply(original: string, current: string, newText: string, colIdx: number): any
  var diff = SimpleStringDiff(original, current, colIdx)
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
