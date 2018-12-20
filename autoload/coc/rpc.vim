let s:is_win = has("win32") || has("win64")
let s:client = v:null
let s:name = 'coc'

function! coc#rpc#start_server()
  if $NODE_ENV ==# 'test'
    " server already started
    let s:client = coc#client#create(s:name, [])
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

function! coc#rpc#set_channel_id(chan_id)
  if empty(s:client) | return | endif
  let s:client['running'] = 1
  let s:client['chan_id'] = a:chan_id
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
  return coc#client#request(s:name, a:method, a:args)
endfunction

function! coc#rpc#notify(method, args) abort
  call coc#client#notify(s:name, a:method, a:args)
endfunction

function! coc#rpc#request_async(method, args, cb) abort
  call coc#client#request_async(s:name, a:method, a:args, a:cb)
endfunction

" receive async response
function! coc#rpc#async_response(id, resp, isErr) abort
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
