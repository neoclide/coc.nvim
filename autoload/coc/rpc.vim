let s:is_win = has("win32") || has("win64")
let s:client = v:null
let s:name = 'coc'
let s:is_vim = !has('nvim')

function! coc#rpc#start_server()
  if $NODE_ENV ==# 'test'
    " server already started
    let s:client = coc#client#create(s:name, [])
    let s:client['running'] = 1
    let s:client['chan_id'] = get(g:, 'coc_node_channel_id', 0)
    call dictwatcheradd(g:, 'coc_node_channel_id', function('s:ChannelSet'))
    return
  endif
  if empty(s:client)
    let cmd = coc#util#job_command()
    if empty(cmd) | return | endif
    let $VIMCONFIG = coc#util#get_config_home()
    let s:client = coc#client#create(s:name, cmd)
  endif
  call s:client['start']()
endfunction

function! coc#rpc#ready()
  if empty(s:client) || s:client['running'] == 0 | return 0 | endif
  if s:is_vim && empty(s:client['job'])
    return 0
  elseif !s:is_vim && s:client['chan_id'] == 0
    return 0
  endif
  return 1
endfunction

function! s:ChannelSet(dict, key, val)
  let chan_id = get(a:val, 'new', 0)
  if empty(s:client) | return | endif
  let s:client['running'] = 1
  let s:client['chan_id'] = chan_id
  call dictwatcherdel(g:, 'coc_node_channel_id', function('s:ChannelSet'))
endfunction

function! coc#rpc#kill()
  let pid = get(g:, 'coc_process_pid', 0)
  if !pid | return | endif
  if s:is_win
    call system('taskkill /PID '.pid)
  else
    call system('kill -9 '.pid)
  endif
endfunction

function! coc#rpc#get_errors()
  if empty(s:client) | return | endif
  return s:client['stderrs']
endfunction

function! coc#rpc#stop()
  return coc#client#stop(s:name)
endfunction

function! coc#rpc#restart()
  call coc#client#restart(s:name)
endfunction

function! coc#rpc#request(method, args) abort
  if empty(s:client) | return | endif
  return s:client['request'](a:method, a:args)
endfunction

function! coc#rpc#notify(method, args) abort
  if empty(s:client) | return '' | endif
  call s:client['notify'](a:method, a:args)
  return ''
endfunction

function! coc#rpc#request_async(method, args, cb) abort
  if empty(s:client) | return | endif
  call s:client['request_async'](a:method, a:args, a:cb)
endfunction

" receive async response
function! coc#rpc#async_response(id, resp, isErr) abort
  if empty(s:client) | return | endif
  call coc#client#on_response(s:name, a:id, a:resp, a:isErr)
endfunction

" send async response to server
function! coc#rpc#async_request(id, method, args)
  let l:Cb = {err, res -> coc#rpc#notify('nvim_async_response_event', [a:id, err, res])}
  let args = a:args + [l:Cb]
  try
    call call(a:method, args)
  catch /.*/
    call coc#rpc#notify('nvim_async_response_event', [a:id, v:exception])
  endtry
endfunction

function! coc#rpc#vim_rpc_folder() abort
  let folder = expand(get(g:, 'vim_node_rpc_folder', ''))
  if isdirectory(folder)
    return folder
  endif
  if executable('yarn')
    let dir = expand('~').'/.config/yarn/global'
    if s:is_win
      let dir = $LOCALAPPDATA.'\Yarn\Data\global'
    endif
    if !isdirectory(dir)
      let dir = trim(systemlist('yarn global dir --offline -s')[-1])
    endif
    let p = dir . '/node_modules/vim-node-rpc'
    if isdirectory(p)
      return p
    endif
  endif
  if executable('npm')
    let root = trim(system('npm --loglevel silent root -g'))
    let p = root . '/vim-node-rpc'
    if isdirectory(p)
      return p
    endif
  endif
  if !empty(p)
    " resolve once
    let g:vim_node_rpc_folder = p
  endif
  return ''
endfunction

function! coc#rpc#install_node_rpc(...) abort
  let isUpdate = get(a:, 1, 0)
  if isUpdate
    let res = coc#util#prompt_confirm('Your vim-node-rpc need upgrade, upgrade?')
  else
    let res = coc#util#prompt_confirm('vim-node-rpc module not found, install?')
  endif
  if !res | return 0 | endif
  if !executable('yarn')
    echohl Error | echom 'yarn not found in $PATH checkout https://yarnpkg.com/en/docs/install.' | echohl None
    return 0
  endif
  let cmd = 'yarn global add vim-node-rpc'
  execute '!'.cmd
  return v:shell_error == 0
endfunction

function! coc#rpc#init_vim_rpc() abort
  let folder = coc#rpc#vim_rpc_folder()
  if empty(folder)
    let installed = coc#rpc#install_node_rpc()
    if !installed | return 0 | endif
    let folder = coc#rpc#vim_rpc_folder()
  endif
  if !isdirectory(folder) | return 0 | endif
  execute 'set rtp^='.expand(folder)
  try
    let started = nvim#rpc#start_server()
    return started
  catch /^Vim\%((\a\+)\)\=:E117/
    let installed = coc#rpc#install_node_rpc(1)
    if !installed | return 0 | endif
    let folder = coc#rpc#vim_rpc_folder()
    if !isdirectory(folder) | return 0 | endif
    let started = nvim#rpc#start_server()
    return started
  endtry
endfunction
