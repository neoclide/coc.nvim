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
  if synName ==# 'vimString' || synName ==# 'vimLineComment' | return 0 | endif
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
    let o = {}
    for [key, value] in items(item)
      if key ==# 'word' && value =~# '($'
        let o[key] = value[0:-2]
      elseif key ==# 'word' && value =~# '()$'
        let o[key] = value[0:-3]
      else
        let o[key] = value
      endif
    endfor
    call add(res, o)
  endfor
  return res
endfunction
