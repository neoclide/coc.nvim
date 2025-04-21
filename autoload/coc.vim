scriptencoding utf-8
let g:coc_user_config = get(g:, 'coc_user_config', {})
let g:coc_global_extensions = get(g:, 'coc_global_extensions', [])
let g:coc_selected_text = ''
let g:coc_vim_commands = []
let s:watched_keys = []
let s:is_vim = !has('nvim')
let s:utf = has('nvim') || &encoding =~# '^utf'
let s:error_sign = get(g:, 'coc_status_error_sign', has('mac') && s:utf ? "\u274c " : 'E ')
let s:warning_sign = get(g:, 'coc_status_warning_sign', has('mac') && s:utf ? "\u26a0\ufe0f " : 'W ')
let s:select_api = exists('*nvim_select_popupmenu_item')
let s:callbacks = {}
let s:fns = ['init', 'complete', 'should_complete', 'refresh', 'get_startcol', 'on_complete', 'on_enter']
let s:all_fns = s:fns + map(copy(s:fns), 'toupper(strpart(v:val, 0, 1)) . strpart(v:val, 1)')

function! coc#expandable() abort
  return coc#rpc#request('snippetCheck', [1, 0])
endfunction

function! coc#jumpable() abort
  return coc#rpc#request('snippetCheck', [0, 1])
endfunction

function! coc#expandableOrJumpable() abort
  return coc#rpc#request('snippetCheck', [1, 1])
endfunction

" Only clear augroup starts with coc
function! coc#clearGroups(prefix) abort
  for group in getcompletion('coc', 'augroup')
    if group =~# '^' . a:prefix
      execute 'autocmd! ' . group
    endif
  endfor
endfunction

" add vim command to CocCommand list
function! coc#add_command(id, cmd, ...)
  let config = {'id':a:id, 'cmd':a:cmd, 'title': get(a:,1,'')}
  call add(g:coc_vim_commands, config)
  if !coc#rpc#ready() | return | endif
  call coc#rpc#notify('addCommand', [config])
endfunction

function! coc#on_enter()
  call coc#rpc#notify('CocAutocmd', ['Enter', bufnr('%')])
  return ''
endfunction

function! coc#_insert_key(method, key, ...) abort
  let prefix = ''
  if get(a:, 1, 1)
    if coc#pum#visible()
      let prefix = "\<C-r>=coc#pum#close()\<CR>"
    elseif pumvisible()
      let prefix = "\<C-x>\<C-z>"
    endif
  endif
  return prefix."\<c-r>=coc#rpc#".a:method."('doKeymap', ['".a:key."'])\<CR>"
endfunction

" used for statusline
function! coc#status(...)
  let info = get(b:, 'coc_diagnostic_info', {})
  let msgs = []
  if !empty(info) && get(info, 'error', 0)
    call add(msgs, s:error_sign . info['error'])
  endif
  if !empty(info) && get(info, 'warning', 0)
    call add(msgs, s:warning_sign . info['warning'])
  endif
  let status = get(g:, 'coc_status', '')
  if get(a:, 1, 0)
    let status = substitute(status, '%', '%%', 'g')
  endif
  return trim(join(msgs, ' ') . ' ' . status)
endfunction

function! coc#config(section, value)
  let g:coc_user_config[a:section] = a:value
  call coc#rpc#notify('updateConfig', [a:section, a:value])
endfunction

" Deprecated, use variable instead.
function! coc#add_extension(...)
  if a:0 == 0 | return | endif
  call extend(g:coc_global_extensions, a:000)
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

function! coc#on_notify(id, method, Cb)
  let key = a:id. '-'.a:method
  let s:callbacks[key] = a:Cb
  call coc#rpc#notify('registerNotification', [a:id, a:method])
endfunction

function! coc#do_notify(id, method, result)
  let key = a:id. '-'.a:method
  let Fn = s:callbacks[key]
  if !empty(Fn)
    call Fn(a:result)
  endif
endfunction

function! coc#start(...)
  call CocActionAsync('startCompletion', get(a:, 1, {}))
  return ''
endfunction

" Could be used by coc extensions
function! coc#_cancel(...)
  call coc#pum#close()
endfunction

function! coc#refresh() abort
  return "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#_select_confirm() abort
  return "\<C-r>=coc#pum#select_confirm()\<CR>"
endfunction

function! coc#_suggest_variables() abort
  return {
      \ 'disable': get(b:, 'coc_suggest_disable', 0),
      \ 'disabled_sources': get(b:, 'coc_disabled_sources', []),
      \ 'blacklist': get(b:, 'coc_suggest_blacklist', []),
      \ }
endfunction

function! coc#_remote_fns(name)
  let res = []
  for fn in s:all_fns
    if exists('*coc#source#'.a:name.'#'.fn)
      call add(res, fn)
    endif
  endfor
  return res
endfunction

function! coc#_do_complete(name, opt, cb) abort
  let method = get(a:opt, 'vim9', v:false) ? 'Complete' : 'complete'
  let handler = 'coc#source#'.a:name.'#'.method
  let l:Cb = {res -> a:cb(v:null, res)}
  let args = [a:opt, l:Cb]
  call call(handler, args)
endfunction
