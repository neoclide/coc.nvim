scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:clients = {}

if get(g:, 'node_client_debug', 0)
  echohl WarningMsg | echo '[coc.nvim] Enable g:node_client_debug could impact your vim experience' | echohl None
  let $NODE_CLIENT_LOG_LEVEL = 'debug'
  if exists('$NODE_CLIENT_LOG_FILE')
    let s:logfile = resolve($NODE_CLIENT_LOG_FILE)
  else
    let s:logfile = tempname()
    let $NODE_CLIENT_LOG_FILE = s:logfile
  endif
endif

" create a client
function! coc#client#create(name, command)
  let client = {}
  let client['command'] = a:command
  let client['name'] = a:name
  let client['running'] = 0
  let client['async_req_id'] = 1
  let client['async_callbacks'] = {}
  " vim only
  let client['channel'] = v:null
  " neovim only
  let client['chan_id'] = 0
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
  if !isdirectory(getcwd())
    echoerr '[coc.nvim] Current cwd is not a valid directory.'
    return
  endif
  let tmpdir = fnamemodify(tempname(), ':p:h')
  let env = { 'NODE_NO_WARNINGS': '1', 'TMPDIR': coc#util#win32unix_to_node(tmpdir)}
  if s:is_vim
    let env['VIM_NODE_RPC'] = 1
    if get(g:, 'node_client_debug', 0) || $COC_VIM_CHANNEL_ENABLE == '1'
      let file = tmpdir . '/coc.log'
      call ch_logfile(file, 'w')
      echohl MoreMsg | echo '[coc.nvim] channel log to '.file | echohl None
    endif
    let options = {
          \ 'noblock': 1,
          \ 'in_mode': 'json',
          \ 'out_mode': 'json',
          \ 'err_mode': 'nl',
          \ 'err_cb': {channel, message -> s:on_stderr(self.name, split(message, "\n"))},
          \ 'exit_cb': {channel, code -> s:on_exit(self.name, code)},
          \ 'env': env
          \}
    let job = job_start(self.command, options)
    let status = job_status(job)
    if status !=# 'run'
      let self.running = 0
      echohl Error | echom 'Failed to start '.self.name.' service' | echohl None
      return
    endif
    let self['channel'] = job_getchannel(job)
  else
    let opts = {
          \ 'rpc': 1,
          \ 'on_stderr': {channel, msgs -> s:on_stderr(self.name, msgs)},
          \ 'on_exit': {channel, code -> s:on_exit(self.name, code)},
          \ 'env': env
          \ }
    let chan_id = jobstart(self.command, opts)
    if chan_id <= 0
      echohl Error | echom 'Failed to start '.self.name.' service' | echohl None
      return
    endif
    let self['chan_id'] = chan_id
  endif
  let self['running'] = 1
endfunction

function! s:on_stderr(name, msgs)
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  let data = filter(copy(a:msgs), '!empty(v:val)')
  if empty(data) | return | endif
  let client = a:name ==# 'coc' ? '[coc.nvim]' : '['.a:name.']'
  let data[0] = client.': '.data[0]
  if a:name ==# 'coc' && len(filter(copy(data), 'v:val =~# "SyntaxError: "'))
    call coc#client#check_version()
    return
  endif
  if get(g:, 'coc_disable_uncaught_error', 0) | return | endif
  call s:on_error(a:name, data)
endfunction

function! coc#client#check_version() abort
  if (has_key(g:, 'coc_node_path'))
    let node = expand(g:coc_node_path)
  else
    let node = $COC_NODE_PATH == '' ? 'node' : $COC_NODE_PATH
  endif
  let cmd = node . ' --version'
  let output = system(cmd)
  let msgs = []
  if v:shell_error
    let msgs = ['Unexpected result from "'.cmd.'"'] + split(output, '\n')
  else
    let ms = matchlist(output, 'v\(\d\+\).\(\d\+\).\(\d\+\)')
    if empty(ms)
      let msgs = ['Unable to get node version by "'.cmd.'" please install NodeJS from https://nodejs.org/en/download/']
    elseif str2nr(ms[1]) < 16 || (str2nr(ms[1]) == 16 && str2nr(ms[2]) < 18)
      let msgs = ['Current Node.js version '.trim(output).' < 16.18.0 ', 'Please upgrade your Node.js']
    endif
  endif
  if !empty(msgs)
    call s:on_error('coc', msgs)
  endif
endfunction

function! s:on_exit(name, code) abort
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return | endif
  if client['running'] != 1 | return | endif
  let client['running'] = 0
  let client['chan_id'] = 0
  let client['channel'] = v:null
  let client['async_req_id'] = 1
  if a:code != 0 && a:code != 143 && a:code != -1
    echohl Error | echom 'client '.a:name. ' abnormal exit with: '.a:code | echohl None
  endif
endfunction

function! coc#client#get_client(name) abort
  return get(s:clients, a:name, v:null)
endfunction

function! coc#client#get_channel(client)
  if s:is_vim
    return a:client['channel']
  endif
  return a:client['chan_id']
endfunction

function! s:request(method, args) dict
  let channel = coc#client#get_channel(self)
  if empty(channel) | return '' | endif
  try
    if s:is_vim
      let res = ch_evalexpr(channel, [a:method, a:args], {'timeout': 60 * 1000})
      if type(res) == 1 && res ==# ''
        throw 'request '.a:method. ' '.string(a:args).' timeout after 60s'
      endif
      let [l:errmsg, res] =  res
      if !empty(l:errmsg)
        throw 'Error on "'.a:method.'" request: '.l:errmsg
      else
        return res
      endif
    else
      return call('rpcrequest', [channel, a:method] + a:args)
    endif
  catch /.*/
    if v:exception =~# 'E475'
      if get(g:, 'coc_vim_leaving', 0) | return | endif
      echohl Error | echom '['.self.name.'] server connection lost' | echohl None
      let name = self.name
      call s:on_exit(name, 0)
      execute 'silent do User ConnectionLost'.toupper(name[0]).name[1:]
    elseif v:exception =~# 'E12'
      " neovim's bug, ignore it
    else
      if s:is_vim
        throw v:exception
      else
        throw 'Error on request: '.v:exception
      endif
    endif
  endtry
endfunction

function! s:notify(method, args) dict
  let channel = coc#client#get_channel(self)
  if empty(channel)
    return ''
  endif
  try
    if s:is_vim
      call ch_sendraw(channel, json_encode([0, [a:method, a:args]])."\n")
    else
      call call('rpcnotify', [channel, a:method] + a:args)
    endif
  catch /.*/
    if v:exception =~# 'E475'
      if get(g:, 'coc_vim_leaving', 0)
        return
      endif
      echohl Error | echom '['.self.name.'] server connection lost' | echohl None
      let name = self.name
      call s:on_exit(name, 0)
      execute 'silent do User ConnectionLost'.toupper(name[0]).name[1:]
    elseif v:exception =~# 'E12'
      " neovim's bug, ignore it
    else
      echohl Error | echo 'Error on notify ('.a:method.'): '.v:exception | echohl None
    endif
  endtry
endfunction

function! s:request_async(method, args, cb) dict
  let channel = coc#client#get_channel(self)
  if empty(channel) | return '' | endif
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
  try
    if s:is_vim
      let status = job_status(ch_getjob(client['channel']))
      return status ==# 'run'
    else
      let chan_id = client['chan_id']
      let [code] = jobwait([chan_id], 10)
      return code == -1
    endif
  catch /.*/
    return 0
  endtry
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
    call job_stop(ch_getjob(client['channel']), 'term')
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

function! coc#client#kill(name) abort
  let client = get(s:clients, a:name, v:null)
  if empty(client) | return 1 | endif
  let running = coc#client#is_running(a:name)
  if empty(client) || exists('$COC_NVIM_REMOTE_ADDRESS')
    return 1
  endif
  if running
    if s:is_vim
      call job_stop(ch_getjob(client['channel']), 'kill')
    else
      call jobstop(client['chan_id'])
    endif
  endif
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
    call coc#client#restart(key)
  endfor
endfunction

function! coc#client#open_log()
  if !get(g:, 'node_client_debug', 0)
    throw '[coc.nvim] use let g:node_client_debug = 1 in your vimrc to enable debug mode.'
    return
  endif
  execute 'vs '.s:logfile
endfunction

function! coc#client#get_log()
  if !get(g:, 'node_client_debug', 0)
    throw '[coc.nvim] use let g:node_client_debug = 1 in your vimrc to enable debug mode.'
    return ''
  endif
  return s:logfile
endfunction

function! s:on_error(name, msgs) abort
  echohl ErrorMsg
  echo join(a:msgs, "\n")
  echohl None
  let client = get(s:clients, a:name, v:null)
  if !empty(client)
    let errors = get(client, 'stderr', [])
    call extend(errors, a:msgs)
    let client['stderr'] = errors
  endif
endfunction
