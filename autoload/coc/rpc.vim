let s:server_running = 0
let s:script = expand('<sfile>:h:h:h').'/bin/server.js'
let s:root_file = expand('<sfile>:h:h:h').'/lib/index.js'
let s:std_err = []
let s:job_opts = {}
let s:error_buf = -1
let s:is_vim = !has('nvim')

function! coc#rpc#start_server()
  if !s:check_env() | return | endif
  if s:server_running | return | endif
  if s:is_vim
    let job = job_start(['node', s:script], {
          \ 'in_io': 'null',
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:job_opts.on_stderr(0, [message], 'stderr')},
          \ 'out_cb': {channel, message -> s:job_opts.on_stdout(0, [message], 'stderr')},
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
    let channel_id = jobstart(['node', s:script], s:job_opts)
    if channel_id <= 0
      echoerr '[coc.nvim] Failed to start coc service'
      return
    endif
  endif
  let s:server_running = 1
endfunction

function! s:check_env()
  if !executable('node')
    echoerr '[coc.nvim] node not find in $PATH'
    return 0
  endif
  if !filereadable(s:root_file)
    echoerr '[coc.nvim] Unable to start, run `yarn install` in coc.nvim folder'
    return 0
  endif
  return 1
endfunction

function! s:GetChannel()
  " server started
  if get(s:, 'server_running', 0) == 0 | return 0 | endif
  let cid = get(g:, 'coc_node_channel_id', 0)
  if s:is_vim
     return nvim#rpc#check_client(cid) ? cid : 0
  endif
  return cid
endfunction

function! s:job_opts.on_stderr(chan_id, data, event) dict
  call extend(s:std_err, a:data)
  if bufexists(s:error_buf)
    let wnr = bufwinnr(s:error_buf)
    if wnr != -1
      execute wnr.'wincmd w'
      call append(line('$'), a:data)
    endif
  endif
endfunction

function! s:job_opts.on_stdout(chan_id, data, event) dict
  if $NVIM_COC_LOG_LEVEL ==# 'debug'
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
    echohl MoreMsg | echon '[coc.nvim] No errors found.' | echohl None
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
