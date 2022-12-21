scriptencoding utf-8
let s:is_win = has("win32") || has("win64")
let s:client = v:null
let s:name = 'coc'
let s:is_vim = !has('nvim')
let s:chan_id = 0
let s:root = expand('<sfile>:h:h:h')

function! coc#rpc#start_server()
  let test = get(g:, 'coc_node_env', '') ==# 'test'
  if test && !s:is_vim && !exists('$COC_NVIM_REMOTE_ADDRESS')
    " server already started, chan_id could be available later
    let s:client = coc#client#create(s:name, [])
    let s:client['running'] = s:chan_id != 0
    let s:client['chan_id'] = s:chan_id
    return
  endif
  if exists('$COC_NVIM_REMOTE_ADDRESS')
    let address = $COC_NVIM_REMOTE_ADDRESS
    if s:is_vim
      let s:client = coc#client#create(s:name, [])
      " TODO don't know if vim support named pipe on windows.
      let address = address =~# ':\d\+$' ? address : 'unix:'.address
      let channel = ch_open(address, {
          \ 'mode': 'json',
          \ 'close_cb': {channel -> s:on_channel_close()},
          \ 'noblock': 1,
          \ 'timeout': 1000,
          \ })
      if ch_status(channel) == 'open'
        let s:client['running'] = 1
        let s:client['channel'] = channel
      endif
    else
      let s:client = coc#client#create(s:name, [])
      try
        let mode = address =~# ':\d\+$' ? 'tcp' : 'pipe'
        let chan_id = sockconnect(mode, address, { 'rpc': 1 })
        if chan_id > 0
          let s:client['running'] = 1
          let s:client['chan_id'] = chan_id
        endif
      catch /connection\ refused/
        " ignroe
      endtry
    endif
    if !s:client['running']
      echohl Error | echom '[coc.nvim] Unable connect to '.address.' from variable $COC_NVIM_REMOTE_ADDRESS' | echohl None
    elseif !test
      let logfile = exists('$NVIM_COC_LOG_FILE') ? $NVIM_COC_LOG_FILE : ''
      let loglevel = exists('$NVIM_COC_LOG_LEVEL') ? $NVIM_COC_LOG_LEVEL : ''
      let runtimepath = join(globpath(&runtimepath, "", 0, 1), ",")
      let data = [s:root, coc#util#get_data_home(), coc#util#get_config_home(), logfile, loglevel, runtimepath]
      if s:is_vim
        call ch_sendraw(s:client['channel'], json_encode(data)."\n")
      else
        call call('rpcnotify', [s:client['chan_id'], 'init'] + data)
      endif
    endif
    return
  endif
  if empty(s:client)
    let cmd = coc#util#job_command()
    if empty(cmd) | return | endif
    let $COC_VIMCONFIG = coc#util#get_config_home()
    let $COC_DATA_HOME = coc#util#get_data_home()
    let s:client = coc#client#create(s:name, cmd)
  endif
  if !coc#client#is_running('coc')
    call s:client['start']()
  endif
  call s:check_vim_enter()
endfunction

function! coc#rpc#started() abort
  return !empty(s:client)
endfunction

function! coc#rpc#ready()
  if empty(s:client) || s:client['running'] == 0
    return 0
  endif
  return 1
endfunction

" Used for test on neovim only
function! coc#rpc#set_channel(chan_id) abort
  let s:chan_id = a:chan_id
  let s:client['running'] = a:chan_id != 0
  let s:client['chan_id'] = a:chan_id
endfunction

function! coc#rpc#get_channel() abort
  if empty(s:client)
    return v:null
  endif
  return coc#client#get_channel(s:client)
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

function! coc#rpc#show_errors()
  let client = coc#client#get_client('coc')
  if !empty(client)
    let lines = get(client, 'stderr', [])
    keepalt new +setlocal\ buftype=nofile [Stderr of coc.nvim]
    setl noswapfile wrap bufhidden=wipe nobuflisted nospell
    call append(0, lines)
    exe "normal! z" . len(lines) . "\<cr>"
    exe "normal! gg"
  endif
endfunction

function! coc#rpc#stop()
  if empty(s:client)
    return
  endif
  try
    if s:is_vim
      call job_stop(ch_getjob(s:client['channel']), 'term')
    else
      call jobstop(s:client['chan_id'])
    endif
  catch /.*/
    " ignore
  endtry
endfunction

function! coc#rpc#restart()
  if empty(s:client)
    call coc#rpc#start_server()
  else
    call coc#highlight#clear_all()
    call coc#ui#sign_unplace()
    call coc#float#close_all()
    autocmd! coc_dynamic_autocmd
    autocmd! coc_dynamic_content
    autocmd! coc_dynamic_option
    call coc#rpc#request('detach', [])
    let g:coc_service_initialized = 0
    sleep 100m
    if exists('$COC_NVIM_REMOTE_ADDRESS')
      call coc#rpc#close_connection()
      sleep 100m
      call coc#rpc#start_server()
    else
      let s:client['command'] = coc#util#job_command()
      call coc#client#restart(s:name)
      call s:check_vim_enter()
    endif
    echohl MoreMsg | echom 'starting coc.nvim service' | echohl None
  endif
endfunction

function! coc#rpc#close_connection() abort
  let channel = coc#rpc#get_channel()
  if channel == v:null
    return
  endif
  if s:is_vim
    " Unlike neovim, vim not close the socket as expected.
    call ch_close(channel)
  else
    call chanclose(channel)
  endif
  let s:client['running'] = 0
  let s:client['channel'] = v:null
  let s:client['chan_id'] = 0
endfunction

function! coc#rpc#request(method, args) abort
  if !coc#rpc#ready()
    return ''
  endif
  return s:client['request'](a:method, a:args)
endfunction

function! coc#rpc#notify(method, args) abort
  if !coc#rpc#ready()
    return ''
  endif
  call s:client['notify'](a:method, a:args)
  return ''
endfunction

function! coc#rpc#request_async(method, args, cb) abort
  if !coc#rpc#ready()
    return cb('coc.nvim service not started.')
  endif
  call s:client['request_async'](a:method, a:args, a:cb)
endfunction

" receive async response
function! coc#rpc#async_response(id, resp, isErr) abort
  if empty(s:client)
    return
  endif
  call coc#client#on_response(s:name, a:id, a:resp, a:isErr)
endfunction

" send async response to server
function! coc#rpc#async_request(id, method, args)
  let l:Cb = {err, ... -> coc#rpc#notify('nvim_async_response_event', [a:id, err, get(a:000, 0, v:null)])}
  let args = a:args + [l:Cb]
  try
    call call(a:method, args)
  catch /.*/
    call coc#rpc#notify('nvim_async_response_event', [a:id, v:exception, v:null])
  endtry
endfunction

function! s:check_vim_enter() abort
  if s:client['running'] && v:vim_did_enter
    call coc#rpc#notify('VimEnter', [coc#util#path_replace_patterns(), join(globpath(&runtimepath, "", 0, 1), ",")])
  endif
endfunction

" Used on vim and remote address only
function! s:on_channel_close() abort
  if get(g:, 'coc_node_env', '') !=# 'test'
    echohl Error | echom '[coc.nvim] channel closed' | echohl None
  endif
  if !empty(s:client)
    let s:client['running'] = 0
    let s:client['channel'] = v:null
    let s:client['async_req_id'] = 1
  endif
endfunction
