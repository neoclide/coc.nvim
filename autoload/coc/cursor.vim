scriptencoding utf-8

" Position of cursor relative to screen cell
function! coc#cursor#screen_pos() abort
  let nr = winnr()
  let [row, col] = win_screenpos(nr)
  return [row + winline() - 2, col + wincol() - 2]
endfunction

function! coc#cursor#move_by_col(delta)
  let pos = getcurpos()
  call cursor(pos[1], pos[2] + a:delta)
endfunction

" Get cursor position.
function! coc#cursor#position()
  return [line('.') - 1, strchars(strpart(getline('.'), 0, col('.') - 1))]
endfunction

" Move cursor to position.
function! coc#cursor#move_to(line, character) abort
  let content = getline(a:line + 1)
  let pre = strcharpart(content, 0, a:character)
  let col = strlen(pre) + 1
  call cursor(a:line + 1, col)
endfunction

" Character offset of current cursor, vim provide bytes offset only.
function! coc#cursor#char_offset() abort
  let offset = 0
  let lnum = line('.')
  for i in range(1, lnum)
    if i == lnum
      let offset += strchars(strpart(getline('.'), 0, col('.')-1))
    else
      let offset += strchars(getline(i)) + 1
    endif
  endfor
  return offset
endfunction

