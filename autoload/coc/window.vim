function! coc#window#tabnr(winid) abort
  if exists('*win_execute')
    let ref = {}
    call win_execute(a:winid, 'let ref["out"] = tabpagenr()')
    return get(ref, 'out', -1)
  elseif has('nvim')
    let info = getwininfo(a:winid)
    return empty(info) ? -1 : info[0]['tabnr']
  else
    throw 'win_execute() not exists, please upgrade your vim.'
  endif
endfunction

function! coc#window#is_float(winid) abort
  if !has('nvim')
    if exists('*popup_list')
      return index(popup_list(), a:winid) != -1
    endif
    return 0
  elseif exists('*nvim_win_get_config')
    let config = nvim_win_get_config(a:winid)
    return !empty(config) && !empty(get(config, 'relative', ''))
  endif
endfunction

function! coc#window#set_height(winid, height) abort
  if empty(getwininfo(a:winid))
    return
  endif
  if exists('*nvim_win_set_height')
    call nvim_win_set_height(a:winid, a:height)
  else
    call coc#compat#execute(a:winid, 'noa resize '.a:height, 'silent')
  endif
endfunction

" Get single window by window variable, current tab only
function! coc#window#find(key, val) abort
  for i in range(1, winnr('$'))
    let res = getwinvar(i, a:key)
    if res == a:val
      return win_getid(i)
    endif
  endfor
  return -1
endfunction

" Visible buffer numbers
function! coc#window#bufnrs() abort
  let winids = []
  if exists('*nvim_list_wins')
    let winids = nvim_list_wins()
  else
    let winids = map(getwininfo(), 'v:val["winid"]')
  endif
  return uniq(map(winids, 'winbufnr(v:val)'))
endfunction

" Make sure window exists
function! coc#window#gotoid(winid) abort
  noa let res = win_gotoid(a:winid)
  if res == 0
    throw 'Invalid window number'
  endif
endfunction

" Avoid errors
function! coc#window#close(winid) abort
  if empty(a:winid) || a:winid == -1
    return
  endif
  if exists('*nvim_win_is_valid') && exists('*nvim_win_close')
    if nvim_win_is_valid(a:winid)
      call nvim_win_close(a:winid, 1)
    endif
  elseif exists('*win_execute')
    call coc#compat#execute(a:winid, 'noa close!', 'silent!')
  else
    let curr = win_getid()
    if curr == a:winid
      silent! close!
    else
      let res = win_gotoid(a:winid)
      if res
        silent! close!
        call win_gotoid(curr)
      endif
    endif
  endif
endfunction

function! coc#window#visible_range(bufnr) abort
  let winid = bufwinid(a:bufnr)
  if winid == -1
    return v:null
  endif
  let info = getwininfo(winid)[0]
  return [info['topline'], info['botline']]
endfunction

function! coc#window#visible_ranges(bufnr) abort
  let wins = gettabinfo(tabpagenr())[0]['windows']
  let res = []
  for id in wins
    let info = getwininfo(id)[0]
    if info['bufnr'] == a:bufnr
      call add(res, [info['topline'], info['botline']])
    endif
  endfor
  return res
endfunction
