let s:server_running = 0
let s:std_err = []
let s:job_opts = {}
let s:error_buf = -1
let s:is_vim = !has('nvim')
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
    let s:job = job_start(cmd, {
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:job_opts.on_stderr(0, [message], 'stderr')},
          \ 'out_cb': {channel, message -> s:job_opts.on_stdout(0, [message], 'stdout')},
          \ 'close_cb': { -> s:job_opts.on_exit(0, 0, 'exit')},
          \ 'env': {
          \   'NVIM_LISTEN_ADDRESS': $NVIM_LISTEN_ADDRESS,
          \   'VIMCONFIG': $VIMCONFIG,
          \ }
          \})
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
  let cid = get(g:, 'coc_node_channel_id', 0)
  if s:is_vim
     return nvim#rpc#check_client(cid) ? cid : 0
  endif
  return cid
endfunction

function! s:job_opts.on_stderr(chan_id, data, event) dict
  call extend(s:std_err, a:data)
  if bufexists(s:error_buf)
    if s:is_vim
      call appendbufline(s:error_buf, '$', a:data)
    else
      call nvim_buf_set_lines(s:error_buf, -1, -1, v:false, a:data)
    endif
  endif
endfunction

function! s:job_opts.on_stdout(chan_id, data, event) dict
  if get(g:, 'coc_node_rpc_debug', 0)
    for msg in a:data
      if !empty(msg)
        echom msg
      endif
    endfor
  endif
endfunction

function! s:job_opts.on_exit(chan_id, code, event) dict
  let s:job = v:null
  let s:channel_id = 0
  let s:server_running = 0
  let g:coc_node_channel_id = 0
  if v:dying != 0 | return | endif
  if a:code != 0
    echohl Error | echomsg '[coc.nvim] Abnormal exited' | echohl None
    if !empty(s:std_err)
      call coc#rpc#show_error()
    endif
  endif
endfunction

function! coc#rpc#append_error(msg) abort
  call add(s:std_err, a:msg)
endfunction

function! coc#rpc#show_error()
  if empty(s:std_err)
    echohl MoreMsg | echon '[coc.nvim] No error messages found.' | echohl None
    return
  endif
  if bufexists(s:error_buf)
    execute 'drop [coc error]'
    return
  endif
  belowright vs +setl\ buftype=nofile [coc error]
  setl bufhidden=wipe
  let s:error_buf = bufnr('%')
  call setline(1, s:std_err)
endfunction

function! coc#rpc#get_errors()
  return s:std_err
endfunction

function! coc#rpc#request(method, args)
  let channel = s:GetChannel()
  if !channel | return | endif
  if s:is_vim
    return nvim#rpc#request(channel, a:method, a:args)
  endif
  return call('rpcrequest', [channel, a:method] + a:args)
endfunction

function! coc#rpc#notify(method, args)
  let channel = s:GetChannel()
  if !channel | return | endif
  if s:is_vim
    call nvim#rpc#notify(channel, a:method, a:args)
  else
    call call('rpcnotify', [channel, a:method] + a:args)
  endif
endfunction

function! coc#rpc#request_async(method, args, cb) abort
  let channel = s:GetChannel()
  if !channel | return | endif
  let id = s:async_req_id
  let s:async_req_id = id + 1
  let s:async_callbacks[id] = a:cb
  let args = [id, a:method, a:args]
  if s:is_vim
    call nvim#rpc#notify(channel, 'nvim_async_request_event', args)
  else
    call call('rpcnotify', [channel, 'nvim_async_request_event'] + args)
  endif
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

function! coc#rpc#restart()
  call coc#util#clear_signs()
  call coc#util#clear_diagnostic_info()
  if has('nvim')
    let [code] = jobwait([s:channel_id], 100)
    " running
    if code == -1
      call jobstop(s:channel_id)
    endif
  elseif s:server_running
    let status = job_status(s:job)
    if status ==# 'run'
      call job_stop(s:job)
    endif
  endif
  sleep 200m
  if s:server_running
    echohl Error | echon '[coc.nvim] kill process failed' | echohl None
    return
  endif
  call coc#rpc#start_server()
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
