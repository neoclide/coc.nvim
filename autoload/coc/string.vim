scriptencoding utf-8

function! coc#string#last_character(line) abort
  return strcharpart(a:line, strchars(a:line) - 1, 1)
endfunction

" Get utf16 code unit index from col (0 based)
function! coc#string#character_index(line, byteIdx) abort
  if a:byteIdx <= 0
    return 0
  endif
  let i = 0
  for char in split(strpart(a:line, 0, a:byteIdx), '\zs')
    let i += char2nr(char) > 65535 ? 2 : 1
  endfor
  return i
endfunction

" Convert utf16 character index to byte index
function! coc#string#byte_index(line, character) abort
  if a:character <= 0
    return 0
  endif
  " code unit index
  let i = 0
  let len = 0
  for char in split(a:line, '\zs')
    let i += char2nr(char) > 65535 ? 2 : 1
    let len += strlen(char)
    if i >= a:character
      break
    endif
  endfor
  return len
endfunction

function! coc#string#character_length(text) abort
  let i = 0
  for char in split(a:text, '\zs')
    let i += char2nr(char) > 65535 ? 2 : 1
  endfor
  return i
endfunction

function! coc#string#reflow(lines, width) abort
  let lines = []
  let currlen = 0
  let parts = []
  for line in a:lines
    for part in split(line, '\s\+')
      let w = strwidth(part)
      if currlen + w + 1 >= a:width
        if len(parts) > 0
          call add(lines, join(parts, ' '))
        endif
        if w >= a:width
          call add(lines, part)
          let currlen = 0
          let parts = []
        else
          let currlen = w
          let parts = [part]
        endif
        continue
      endif
      call add(parts, part)
      let currlen = currlen + w + 1
    endfor
  endfor
  if len(parts) > 0
    call add(lines, join(parts, ' '))
  endif
  return empty(lines) ? [''] : lines
endfunction

" Used when 'wrap' and 'linebreak' is enabled
function! coc#string#content_height(lines, width) abort
  let len = 0
  let pattern = empty(&breakat) ? '.\zs' : '['.substitute(&breakat, '\([\[\]\-]\)', '\\\1', 'g').']\zs'
  for line in a:lines
    if strwidth(line) <= a:width
      let len += 1
    else
      let currlen = 0
      for part in split(line, pattern)
        let wl = strwidth(part)
        if currlen == 0 && wl > 0
          let len += 1
        endif
        let delta = currlen + wl - a:width
        if delta >= 0
          let len = len + (delta > 0)
          let currlen = delta == 0 ? 0 : wl
          if wl >= a:width
            let currlen = wl%a:width
            let len += float2nr(ceil(wl/(a:width + 0.0))) - (currlen == 0)
          endif
        else
          let currlen = currlen + wl
        endif
      endfor
    endif
  endfor
  return len
endfunction

" insert inserted to line at position, use ... when result is too long
" line should only contains character has strwidth equals 1
function! coc#string#compose(line, position, inserted) abort
  let width = strwidth(a:line)
  let text = a:inserted
  let res = a:line
  let need_truncate = a:position + strwidth(text) + 1 > width
  if need_truncate
    let remain = width - a:position - 3
    if remain < 2
      " use text for full line, use first & end of a:line, ignore position
      let res = strcharpart(a:line, 0, 1)
      let w = strwidth(res)
      for i in range(strchars(text))
        let c = strcharpart(text, i, 1)
        let a = strwidth(c)
        if w + a <= width - 1
          let w = w + a
          let res = res . c
        endif
      endfor
      let res = res.strcharpart(a:line, w)
    else
      let res = strcharpart(a:line, 0, a:position)
      let w = strwidth(res)
      for i in range(strchars(text))
        let c = strcharpart(text, i, 1)
        let a = strwidth(c)
        if w + a <= width - 3
          let w = w + a
          let res = res . c
        endif
      endfor
      let res = res.'..'
      let w = w + 2
      let res = res . strcharpart(a:line, w)
    endif
  else
    let first = strcharpart(a:line, 0, a:position)
    let res = first . text . strcharpart(a:line, a:position + strwidth(text))
  endif
  return res
endfunction
