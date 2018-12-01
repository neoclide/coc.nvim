if exists('g:did_node_rpc_loaded') || v:version < 800 || has('nvim')
  finish
endif
let g:did_node_rpc_loaded = 1

let s:is_win = has("win32") || has("win64")
let s:clientIds = []
let s:logfile = tempname()
let s:script = expand('<sfile>:h:h:h').'/node_modules/.bin/vim-node-rpc'
let s:channel = v:null

" env used only for testing purpose
if !empty($NVIM_LISTEN_ADDRESS)
  silent! call delete($NVIM_LISTEN_ADDRESS)
  let s:tempname = $NVIM_LISTEN_ADDRESS
else
  let s:tempname = tempname()
  if s:is_win
    let $NVIM_LISTEN_ADDRESS = '\\?\pipe\'.s:tempname
  else
    let $NVIM_LISTEN_ADDRESS = s:tempname
  endif
endif

if get(g:, 'coc_node_rpc_debug', 0)
  call ch_logfile(s:logfile, 'w')
endif

function! s:on_error(channel, msg)
  echohl Error | echom a:msg | echohl None
endfunction

function! s:on_notify(channel, result)
  let [event, data] = a:result
  if event ==# 'ready'
    doautocmd User NvimRpcInit
  elseif event ==# 'connect'
    call add(s:clientIds, data)
  elseif event ==# 'disconnect'
    call filter(s:clientIds, 'v:val == '.data)
  else
    echo 'notification:'. json_encode(a:result)
  endif
endfunction

function! s:on_exit(channel)
  let s:channel = v:null
  doautocmd User NvimRpcExit
endfunction

function! nvim#rpc#get_script() abort
  if filereadable(s:script)
    return s:script
  endif
  if executable('vim-node-rpc')
    return 'vim-node-rpc'
  endif
  return ''
endfunction

function! nvim#rpc#start_server() abort
  if !empty(s:channel)
    let state = ch_status(s:channel)
    if state ==# 'open' || state ==# 'buffered'
      " running
      return
    endif
  endif
  if !executable('node')
    echohl Error
    echon '[coc.nvim] node executable not found on $PATH.'
    echohl None
    return
  endif
  let script = nvim#rpc#get_script()
  if empty(script) | return | endif
  let command = s:is_win ? script : [script]
  let job = job_start(command, {
        \ 'in_mode': 'json',
        \ 'out_mode': 'json',
        \ 'err_mode': 'nl',
        \ 'callback': function('s:on_notify'),
        \ 'err_cb': function('s:on_error'),
        \ 'close_cb': function('s:on_exit'),
        \ 'timeout': 3000,
        \ 'env': {
        \   'NVIM_LISTEN_ADDRESS': $NVIM_LISTEN_ADDRESS
        \ }
        \})
  let s:channel = job_getchannel(job)
  let status = ch_status(job)
  if status !=# 'open' && status !=# 'buffered'
    echohl Error | echon '[coc.nvim] failed to start vim-node-rpc service!' | echohl None
    return
  endif
  let info = ch_info(s:channel)
  let data = json_encode([0, ['ready', [info.id]]])
  call ch_sendraw(s:channel, data."\n")
endfunction

function! nvim#rpc#request(clientId, method, ...) abort
  if !nvim#rpc#check_client(a:clientId)
    return
  endif
  let args = get(a:, 1, [])
  let res = ch_evalexpr(s:channel, [a:clientId, a:method, args], {'timeout': 5000})
  if type(res) == 1 && res ==# '' | return '' | endif
  let [l:errmsg, res] =  res
  if l:errmsg
    echohl Error | echon '[rpc.vim] client error: '.l:errmsg | echohl None
  else
    return res
  endif
endfunction

function! nvim#rpc#notify(clientId, method, ...) abort
  if empty(s:channel) | return | endif
  let args = get(a:000, 0, [])
  " use 0 as vim request id
  let data = json_encode([0, [a:clientId, a:method, args]])
  call ch_sendraw(s:channel, data."\n")
endfunction

function! nvim#rpc#open_log()
  execute 'vs '.s:logfile
endfunction

function! nvim#rpc#check_client(clientId)
  if empty(s:channel) | return 0 | endif
  return index(s:clientIds, a:clientId) >= 0
endfunction
