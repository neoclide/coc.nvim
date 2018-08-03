let s:server_running = 0
let s:std_err = []
let s:job_opts = {}
let s:error_buf = -1
let s:is_vim = !has('nvim')

function! coc#rpc#start_server()
  if s:server_running | return | endif
  let cmd = coc#util#job_command()
  if empty(cmd) | return | endif
  if s:is_vim
    let job = job_start(cmd, {
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:job_opts.on_stderr(0, [message], 'stderr')},
          \ 'out_cb': {channel, message -> s:job_opts.on_stdout(0, [message], 'stdout')},
          \ 'close_cb': { -> s:job_opts.on_exit(0, 0, 'exit')},
          \ 'env': {
          \   'NVIM_LISTEN_ADDRESS': $NVIM_LISTEN_ADDRESS
          \ }
          \})
    let status = job_status(job)
    if status !=# 'run'
      echoerr '[coc.nvim] Failed to start coc service'
      return
    endif
  else
    let channel_id = jobstart(cmd, s:job_opts)
    if channel_id <= 0
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
  if get(g:, 'nvim_node_rpc_debug', 0)
    for msg in a:data
      echom msg
    endfor
  endif
endfunction

function! s:job_opts.on_exit(chan_id, code, event) dict
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

function! s:empty(item)
  if empty(a:item) | return 1 | endif
  if type(a:item) == 3 && len(a:item) == 1 && get(a:, 'item', 0) == ''
    return 1
  endif
  return 0
endfunction
