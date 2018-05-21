
let s:pattern = '\%(<sid>\|\w:\|&\)\?\k*$'

function! coc#source#neco#init() abort
  " user should set the filetypes
  return {
        \'shortcut': 'NECO',
        \'filetypes': ['vim'],
        \'priority': 10,
        \}
endfunction

function! coc#source#neco#should_complete(opt) abort
  if !get(g:, 'loaded_necovim', 0) | return 0 | endif
  let ch = a:opt['line'][a:opt['col'] - 1]
  if ch ==# '"' || ch ==# "'" | return 0 | endif
  let synName = synIDattr(synID(a:opt['linenr'],a:opt['colnr'],1),"name")
  if synName ==# 'vimString' | return 0 | endif
  return 1
endfunction

function! coc#source#neco#get_startcol(opt) abort
  let colnr = a:opt['colnr']
  let part = a:opt['line'][0:colnr - 1]
  let col = necovim#get_complete_position(part)
  return col
endfunction

function! coc#source#neco#complete(opt, cb) abort
  let colnr = a:opt['colnr']
  let part = a:opt['line'][0:colnr - 2]
  let complete_str = matchstr(part, s:pattern)
  let items = necovim#gather_candidates(part, complete_str)
  call a:cb(s:Filter(a:opt['input'], items))
endfunction

function! s:Filter(input, items)
  let ch = len(a:input) ? a:input[0] : ''
  let res = []
  for item in a:items
    let word = item['word']
    if !empty(ch) && word[0] !=# ch
      continue
    endif
    if word =~# '($'
      let menu = substitute('fn('.item['abbr'][len(word):], ')\zs\s\w\+$', '', '')
      call add(res, {
            \ 'word': word[0:-2],
            \ 'menu': menu,
            \})
    elseif word =~# '()$'
      call add(res, {
            \ 'word': word[0:-3],
            \ 'menu': 'fn()',
            \})
    else
      call add(res, {
            \ 'word': word,
            \ 'abbr': get(item, 'abbr', ''),
            \ 'info': get(item, 'info', ''),
            \})
    endif
  endfor
  return res
endfunction
