let s:server_running = 0
let s:std_err = []
let s:std_out = []
let s:job_opts = {'rpc': 1}
let s:error_buf = -1
let s:is_vim = !has('nvim')
let s:is_win = has("win32") || has("win64")
let s:async_req_id = 1
let s:async_callbacks = {}

let s:job = v:null
let s:channel_id = 0

function! coc#rpc#start_server()
  if s:server_running | return | endif
  let cmd = coc#util#job_command()
  let $VIMCONFIG = coc#util#get_config_home()
  if empty(cmd) | return | endif
  if s:is_vim
    let options = {
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:job_opts.on_stderr(0, [message], 'stderr')},
          \ 'out_cb': {channel, message -> s:job_opts.on_stdout(0, [message], 'stdout')},
          \ 'close_cb': { -> s:job_opts.on_exit(0, 0, 'exit')},
          \ 'env': {
          \   'VIM_NODE_RPC': 1,
          \   'NVIM_LISTEN_ADDRESS': $NVIM_LISTEN_ADDRESS,
          \   'VIMCONFIG': $VIMCONFIG,
          \ }
          \}
    if has("patch-8.1.350")
      let options['noblock'] = 1
    endif
    let s:job = job_start(cmd, options)
    let status = job_status(s:job)
    if status !=# 'run'
      echoerr '[coc.nvim] Failed to start coc service'
      return
    endif
  else
    let s:channel_id = jobstart(cmd, s:job_opts)
    if s:channel_id <= 0
      echoerr '[coc.nvim] Failed to start coc service'
      return
    endif
  endif
  let s:server_running = 1
endfunction

function! s:GetChannel()
  " TODO use vim_node_coc_client_id on vim
  let cid = get(g:, 'coc_node_channel_id', 0)
  if s:is_vim
     return nvim#rpc#check_client(cid) ? cid : 0
  endif
  return cid
endfunction

function! s:job_opts.on_stderr(chan_id, data, event) dict
  call extend(s:std_err, a:data)
  let data = filter(copy(a:data), '!empty(v:val)')
  if empty(data) | return | endif
  let data[0] = '[coc.nvim] ' . data[0]
  call coc#util#echo_messages('Error', data)
endfunction

function! s:job_opts.on_exit(chan_id, code, event) dict
  call s:reset()
  if v:dying != 0 | return | endif
  if a:code != 0
    echoerr '[coc.nvim] Abnormal exited' 
  endif
endfunction

function! s:reset()
  let s:job = v:null
  let s:channel_id = 0
  let s:server_running = 0
  let g:coc_node_channel_id = 0
endfunction

function! coc#rpc#show_error()
  if empty(s:std_err)
    echohl MoreMsg | echo '[coc.nvim] No error' | echohl None
    return
  endif
  echohl Error
  echo join(s:std_err, "\n")
  echohl None
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
  return s:std_err
endfunction

function! coc#rpc#request(method, args) abort
  let channel = s:GetChannel()
  if !channel | return | endif
  try
    if s:is_vim
      return nvim#rpc#request(channel, a:method, a:args)
    endif
    return call('rpcrequest', [channel, a:method] + a:args)
  catch /^Vim\%((\a\+)\)\=:E475/
    echohl Error | echom '[coc.nvim] server connection lost' | echohl None
    call s:reset()
    call coc#rpc#kill()
  endtry
endfunction

function! coc#rpc#notify(method, args) abort
  let channel = s:GetChannel()
  if !channel | return | endif
  try
    if s:is_vim
      call nvim#rpc#notify(channel, a:method, a:args)
    else
      call call('rpcnotify', [channel, a:method] + a:args)
    endif
  catch /^Vim\%((\a\+)\)\=:E475/
    echohl Error | echom '[coc.nvim] server connection lost' | echohl None
    call s:reset()
    call coc#rpc#kill()
  endtry
endfunction

function! coc#rpc#request_async(method, args, cb) abort
  if type(a:cb) != 2
    echohl Error | echon '[coc.nvim] Callback should be function' | echohl None
    return
  endif
  let id = s:async_req_id
  let s:async_req_id = id + 1
  let s:async_callbacks[id] = a:cb
  let args = [id, a:method, a:args]
  call coc#rpc#notify('nvim_async_request_event', args)
endfunction

function! coc#rpc#async_response(id, resp, isErr) abort
  let Callback = get(s:async_callbacks, a:id, v:null)
  call remove(s:async_callbacks, a:id)
  if empty(Callback)
    echohl Error | echon 'callback not found' | echohl None
    return
  endif
  if a:isErr
    call call(Callback, [a:resp, v:null])
  else
    call call(Callback, [v:null, a:resp])
  endif
endfunction

function! coc#rpc#stop()
  if s:job_running()
    if has('nvim')
      call jobstop(s:channel_id)
    else
      call job_stop(s:job, 'term')
    endif
  endif
  sleep 200m
  if s:job_running()
    let s:server_running = 1
    echohl Error | echon '[coc.nvim] kill process failed' | echohl None
    return 1
  endif
  let s:server_running = 0
  echohl MoreMsg | echon '[coc.nvim] service stopped!' | echohl None
  return 0
endfunction

function! s:job_running()
  if has('nvim') && s:channel_id != 0
    let [code] = jobwait([s:channel_id], 10)
    return code == -1
  endif
  if s:is_vim && !empty(s:job)
    let status = job_status(s:job)
    return status ==# 'run'
  endif
endfunction

function! coc#rpc#restart()
  call coc#util#clear_signs()
  call coc#rpc#request('CocAction', ['toggle', 0])
  call coc#rpc#stop()
  if !s:server_running
    call coc#client#restart_all()
    call coc#rpc#start_server()
  endif
endfunction

function! s:empty(item)
  if empty(a:item) | return 1 | endif
  if type(a:item) == 3 && len(a:item) == 1 && get(a:, 'item', 0) ==# ''
    return 1
  endif
  return 0
endfunction

function! coc#rpc#async_request(id, method, args)
  let l:Cb = {err, res -> coc#rpc#notify('nvim_async_response_event', [a:id, err, res])}
  let args = a:args + [l:Cb]
  try
    call call(a:method, args)
  catch /.*/
    call coc#rpc#notify('nvim_async_response_event', [a:id, v:exception])
  endtry
endfunction
