let g:coc#_context = {}
let g:coc_user_config = get(g:, 'coc_user_config', {})
let g:coc_global_extensions = get(g:, 'coc_global_extensions', [])
let g:coc_selected_text = ''
let s:watched_keys = []
let s:is_vim = !has('nvim')
let s:error_sign = get(g:, 'coc_status_error_sign', has('mac') ? '❌ ' : 'E')
let s:warning_sign = get(g:, 'coc_status_warning_sign', has('mac') ? '⚠️ ' : 'W')

function! coc#refresh() abort
  if pumvisible()
    let g:coc#_context['candidates'] = []
    call feedkeys("\<Plug>_", 'i')
  endif
  return "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#_insert_key(method, key, ...) abort
  if get(a:, 1, 1) && pumvisible()
    " keep the line without <C-y>
    let g:coc#_context['candidates'] = []
    call feedkeys("\<Plug>_", 'i')
  endif
  return "\<c-r>=coc#rpc#".a:method."('doKeymap', ['".a:key."'])\<CR>"
endfunction

function! coc#_complete() abort
  let items = get(g:coc#_context, 'candidates', [])
  call complete(
        \ g:coc#_context.start + 1,
        \ items)
  return ''
endfunction

" hack method to avoid vim flicking
function! coc#_reload()
  if &paste | return | endif
  let items = get(g:coc#_context, 'candidates', [])
  if empty(items) | return '' | endif
  call feedkeys("\<Plug>_", 'i')
endfunction

function! coc#_do_complete(start, items)
  let g:coc#_context = {
        \ 'start': a:start,
        \ 'candidates': a:items,
        \}
  call feedkeys("\<Plug>_", 'i')
endfunction

function! coc#_select_confirm()
  let hasSelected = coc#rpc#request('hasSelected', [])
  if hasSelected | return "\<C-y>" | endif
  return "\<down>\<C-y>"
endfunction

function! coc#_hide() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-e>", 'in')
endfunction

function! coc#_cancel()
  if pumvisible()
    let g:coc#_context['candidates'] = []
    call feedkeys("\<Plug>_", 'i')
  endif
endfunction

function! coc#_select() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-y>", 'in')
endfunction

function! coc#start(...)
  if !get(g:, 'coc_enabled', 0)
    return ''
  endif
  let opt = coc#util#get_complete_option()
  call CocActionAsync('startCompletion', extend(opt, get(a:, 1, {})))
  return ''
endfunction

" used for statusline
function! coc#status()
  let info = get(b:, 'coc_diagnostic_info', {})
  let msgs = []
  if get(info, 'error', 0)
    call add(msgs, s:error_sign . info['error'])
  endif
  if get(info, 'warning', 0)
    call add(msgs, s:warning_sign . info['warning'])
  endif
  return join(msgs, ' ') . ' ' . get(g:, 'coc_status', '')
endfunction

function! coc#config(section, value)
  let g:coc_user_config[a:section] = a:value
  call coc#rpc#notify('updateConfig', [a:section, a:value])
endfunction

function! coc#add_extension(...)
  if a:0 == 0 | return | endif
  call extend(g:coc_global_extensions, a:000)
  if get(g:, 'coc_enabled', 0)
    call coc#rpc#notify('addExtensions', [])
  endif
endfunction

function! coc#_choose(index)
  let idx = coc#rpc#request('getCurrentIndex', [])
  if idx == a:index
    return "\<C-y>"
  endif
  let res = ""
  if idx < a:index
    for i in range(a:index - idx)
      let res = res."\<C-n>"
    endfor
  endif
  if idx > a:index
    for i in range(idx - a:index)
      let res = res."\<C-p>"
    endfor
  endif
  let g:res = res
  return res."\<C-y>"
endfunction

function! coc#_watch(key)
  if s:is_vim | return | endif
  if index(s:watched_keys, a:key) == -1
    call add(s:watched_keys, a:key)
    call dictwatcheradd(g:, a:key, function('s:GlobalChange'))
  endif
endfunction

function! coc#_unwatch(key)
  if s:is_vim | return | endif
  let idx = index(s:watched_keys, a:key)
  if idx != -1
    call remove(s:watched_keys, idx)
    call dictwatcherdel(g:, a:key, function('s:GlobalChange'))
  endif
endfunction

function! s:GlobalChange(dict, key, val)
  call coc#rpc#notify('GlobalChange', [a:key, get(a:val, 'old', v:null), get(a:val, 'new', v:null)])
endfunction

function! coc#_map()
  inoremap <buffer> 1 <C-R>=coc#_choose(1)<CR>
  inoremap <buffer> 2 <C-R>=coc#_choose(2)<CR>
  inoremap <buffer> 3 <C-R>=coc#_choose(3)<CR>
  inoremap <buffer> 4 <C-R>=coc#_choose(4)<CR>
  inoremap <buffer> 5 <C-R>=coc#_choose(5)<CR>
  inoremap <buffer> 6 <C-R>=coc#_choose(6)<CR>
  inoremap <buffer> 7 <C-R>=coc#_choose(7)<CR>
  inoremap <buffer> 8 <C-R>=coc#_choose(8)<CR>
  inoremap <buffer> 9 <C-R>=coc#_choose(9)<CR>
  inoremap <buffer> 0 <C-R>=coc#_choose(0)<CR>
endfunction

function! coc#_unmap()
  iunmap <buffer> 1
  iunmap <buffer> 2
  iunmap <buffer> 3
  iunmap <buffer> 4
  iunmap <buffer> 5
  iunmap <buffer> 6
  iunmap <buffer> 7
  iunmap <buffer> 8
  iunmap <buffer> 9
  iunmap <buffer> 0
endfunction
