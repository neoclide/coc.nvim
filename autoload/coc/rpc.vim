let s:server_info = {}
let s:script = expand('<sfile>:h:h:h').'/bin/server.js'
let s:std_err = []
let s:job_opts = {}

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
endfunction

function! s:job_opts.on_exit(chan_id, code, event) dict
  let g:coc_node_channel_id = 0
  if a:code != 0
    echoerr '[coc.nvim] service abnormal exited with code '.a:code
    let msgs = get(s:, 'std_err', [])
    echohl Error | echomsg '[coc.nvim] ' . join(msgs, "\n") | echohl None
    return
  endif
endfunction
