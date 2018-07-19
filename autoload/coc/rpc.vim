let s:server_info = {}
let s:script = expand('<sfile>:h:h:h').'/bin/server.js'
let s:std_err = []
let s:job_opts = {}
let s:error_buf = -1

function! coc#rpc#start_server()
  if !executable('node')
    echoerr '[coc.nvim] node not find in $PATH'
    return
  endif
  if get(g:, 'coc_nvim_channel_id', 0) | return | endif
  let channel_id = jobstart(['node', s:script], s:job_opts)
  if channel_id <= 0
    echoerr '[coc.nvim] Failed to start service'
    return
  endif
  let g:coc_nvim_channel_id = channel_id
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

function! s:job_opts.on_exit(chan_id, code, event) dict
  let g:coc_node_channel_id = 0
  if v:dying != 0 | return | endif
  if a:code != 0
    echohl Error | echomsg '[coc.nvim] abnormal exited' | echohl None
    if !empty(s:std_err)
      call coc#rpc#show_error()
    endif
  endif
endfunction

function! coc#rpc#show_error()
  if empty(s:std_err)
    echohl MoreMsg | echon '[coc.nvim] no errors found.' | echohl None
  endif
  belowright vs +setl\ buftype=nofile [coc error]
  setl bufhidden=wipe
  let s:error_buf = bufnr('%')
  call setline(1, s:std_err)
endfunction
