let s:is_vim = !has('nvim')
let s:is_win = has("win32") || has("win64")
let s:clients = {}

" create a client
function! coc#client#create(name, command)
  let client = {}
  let client['command'] = a:command
  let client['name'] = a:name
  let client['chan_id'] = 0
  let client['running'] = 0
  let client['stderrs'] = []
  " vim only
  let client['job'] = v:null
  let client['async_req_id'] = 1
  let client['async_callbacks'] = {}

  let client['start'] = function('s:start', [], client)
  let client['request'] = function('s:request', [], client)
  let client['notify'] = function('s:notify', [], client)
  let client['request_async'] = function('s:request_async', [], client)
  let client['on_async_response'] = function('s:on_async_response', [], client)

  let s:clients[a:name] = client
  return client
endfunction

function! s:start() dict
  if self.running | return | endif
  if s:is_vim
    if empty($NVIM_LISTEN_ADDRESS)
      let folder = coc#rpc#vim_rpc_folder()
      if empty(folder) | return | endif
      call nvim#rpc#start_server()
    endif
    let self.running = 1
    let options = {
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:on_stderr(self.name, [message])},
          \ 'exit_cb': {channel, code -> s:on_exit(self.name, code)},
          \ 'env': {
          \   'VIM_NODE_RPC': 1,
          \   'NVIM_LISTEN_ADDRESS': $NVIM_LISTEN_ADDRESS,
          \ }
          \}
    if has("patch-8.1.350")
      let options['noblock'] = 1
    endif
    let job = job_start(self.command, options)
    let status = job_status(job)
    if status !=# 'run'
      let self.running = 0
      echohl Error | echon 'Failed to start '.self.name.' service' | echohl None
      return
    endif
    let self['job'] = job
  else
    let chan_id = jobstart(self.command, {
          \ 'rpc': 1,
          \ 'on_stderr': {channel, msgs -> s:on_stderr(self.name, msgs)},
          \ 'on_exit': {channel, code -> s:on_exit(self.name, code)},
          \})
    if chan_id <= 0 || jobwait([chan_id], 10)[0] != -1
      echohl Error | echon 'Failed to start '.self.name.' service' | echohl None
      return
    endif
    let self['chan_id'] = chan_id
    let self['running'] = 1
  endif
endfunction

function! s:on_stderr(name, msgs)
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return | endif
  let data = filter(copy(a:msgs), '!empty(v:val)')
  if empty(data) | return | endif
  call extend(client['stderrs'], data)
  let data[0] = '[vim-node-'.a:name.']: ' . data[0]
  call coc#util#echo_messages('Error', data)
endfunction

function! s:on_exit(name, code) abort
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return | endif
  if client['running'] != 1 | return | endif
  let client['running'] = 0
  let client['chan_id'] = 0
  let client['job'] = v:null
  let client['async_req_id'] = 1
  if s:is_vim
    silent! exe 'unlet g:vim_node_'.a:name.'_client_id'
  endif
  if a:code != 0
    echohl Error | echon 'client '.a:name. ' abnormal exit with: '.a:code | echohl None
  endif
endfunction

function! s:get_channel_id(client)
  if s:is_vim
    return get(g:, 'vim_node_'.a:client['name'].'_client_id', 0)
  endif
  return a:client['chan_id']
endfunction

function! s:request(method, args) dict
  let chan_id = s:get_channel_id(self)
  if !chan_id | return '' | endif
  try
    if s:is_vim
      return nvim#rpc#request(chan_id, a:method, a:args)
    endif
    return call('rpcrequest', [chan_id, a:method] + a:args)
  catch /^Vim\%((\a\+)\)\=:E475/
    echohl Error | echom '['.self.name.'] server connection lost' | echohl None
    let name = self.name
    call s:on_exit(name, 0)
    execute 'silent do User ConnectionLost'.toupper(name[0]).name[1:]
  endtry
endfunction

function! s:notify(method, args) dict
  let chan_id = s:get_channel_id(self)
  if !chan_id | return | endif
  try
    if s:is_vim
      call nvim#rpc#notify(chan_id, a:method, a:args)
    else
      call call('rpcnotify', [chan_id, a:method] + a:args)
    endif
  catch /^Vim\%((\a\+)\)\=:E475/
    echohl Error | echom '['.self['name'].'] server connection lost' | echohl None
    let name = self.name
    call s:on_exit(name, 0)
    execute 'silent do User ConnectionLost'.toupper(name[0]).name[1:]
  endtry
endfunction

function! s:request_async(method, args, cb) dict
  let chan_id = s:get_channel_id(self)
  if !chan_id | return | endif
  if type(a:cb) != 2
    echohl Error | echom '['.self['name'].'] Callback should be function' | echohl None
    return
  endif
  let id = self.async_req_id
  let self.async_req_id = id + 1
  let self.async_callbacks[id] = a:cb
  call self['notify']('nvim_async_request_event', [id, a:method, a:args])
endfunction

function! s:on_async_response(id, resp, isErr) dict
  let Callback = get(self.async_callbacks, a:id, v:null)
  if empty(Callback)
    " should not happen
    echohl Error | echom 'callback not found' | echohl None
    return
  endif
  call remove(self.async_callbacks, a:id)
  if a:isErr
    call call(Callback, [a:resp, v:null])
  else
    call call(Callback, [v:null, a:resp])
  endif
endfunction

function! coc#client#is_running(name) abort
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return 0 | endif
  if !client['running'] | return 0 | endif
  if s:is_vim
    let status = job_status(client['job'])
    return status ==# 'run'
  else
    let chan_id = client['chan_id']
    let [code] = jobwait([chan_id], 10)
    return code == -1
  endif
endfunction

function! coc#client#stop(name) abort
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return 1 | endif
  let running = coc#client#is_running(a:name)
  if !running
    echohl WarningMsg | echom 'client '.a:name. ' not running.' | echohl None
    return 1
  endif
  if s:is_vim
    call job_stop(client['job'], 'term')
  else
    call jobstop(client['chan_id'])
  endif
  sleep 200m
  if coc#client#is_running(a:name)
    echohl Error | echom 'client '.a:name. ' stop failed.' | echohl None
    return 0
  endif
  call s:on_exit(a:name, 0)
  echohl MoreMsg | echom 'client '.a:name.' stopped!' | echohl None
  return 1
endfunction

function! coc#client#request(name, method, args)
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    return client['request'](a:method, a:args)
  endif
endfunction

function! coc#client#notify(name, method, args)
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    call client['notify'](a:method, a:args)
  endif
endfunction

function! coc#client#request_async(name, method, args, cb)
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    call client['request_async'](a:method, a:args, a:cb)
  endif
endfunction

function! coc#client#on_response(name, id, resp, isErr)
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    call client['on_async_response'](a:id, a:resp, a:isErr)
  endif
endfunction

function! coc#client#restart(name) abort
  let stopped = coc#client#stop(a:name)
  if !stopped | return | endif
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    call client['start']()
  endif
endfunction

function! coc#client#restart_all()
  for key in keys(s:clients)
    if key !=# 'coc'
      call coc#client#restart(key)
    endif
  endfor
endfunction
