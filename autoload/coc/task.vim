" ============================================================================
" Description: Manage long running tasks.
" Author: Qiming Zhao <chemzqm@gmail.com>
" Licence: MIT licence
" Version: 0.1
" Last Modified:  April 08, 2019
" ============================================================================

let s:is_vim = !has('nvim')
let s:running_task = {}

function! coc#task#start(id, opts)
  if coc#task#running(a:id)
    call coc#task#stop(a:id)
  endif
  let cmd = [a:opts['cmd']] + get(a:opts, 'args', [])
  let cwd = get(a:opts, 'cwd', getcwd())
  " cmd args cwd pty
  if s:is_vim
    let options = {
          \ 'cwd': cwd,
          \ 'err_mode': 'nl',
          \ 'out_mode': 'nl',
          \ 'err_cb': {channel, message -> s:on_stderr(a:id, [message])},
          \ 'out_cb': {channel, message -> s:on_stdout(a:id, [message])},
          \ 'exit_cb': {channel, code -> s:on_exit(a:id, code)},
          \}
    if has("patch-8.1.350")
      let options['noblock'] = 1
    endif
    if get(a:opts, 'pty', 0)
      let options['pty'] = 1
    endif
    let job = job_start(cmd, options)
    let status = job_status(job)
    if status !=# 'run'
      echohl Error | echom 'Failed to start '.a:id.' task' | echohl None
      return v:false
    endif
    let s:running_task[a:id] = job
  else
    let options = {
          \ 'cwd': cwd,
          \ 'on_stderr': {channel, msgs -> s:on_stderr(a:id, filter(msgs, 'v:val !=""'))},
          \ 'on_stdout': {channel, msgs -> s:on_stdout(a:id, filter(msgs, 'v:val !=""'))},
          \ 'on_exit': {channel, code -> s:on_exit(a:id, code)},
          \ 'detach': get(a:opts, 'detach', 0),
          \}
    if get(a:opts, 'pty', 0)
      let options['pty'] = 1
    endif
    let chan_id = jobstart(cmd, options)
    if chan_id <= 0
      echohl Error | echom 'Failed to start '.a:id.' task' | echohl None
      return v:false
    endif
    let s:running_task[a:id] = chan_id
  endif
  return v:true
endfunction

function! coc#task#stop(id)
  let job = get(s:running_task, a:id, v:null)
  if !job | return | endif
  if s:is_vim
    call job_stop(job, 'term')
  else
    call jobstop(job)
  endif
  sleep 50m
  let running = coc#task#running(a:id)
  if running
    echohl Error | echom 'job '.a:id. ' stop failed.' | echohl None
  endif
endfunction

function! s:on_exit(id, code) abort
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  if has_key(s:running_task, a:id)
    call remove(s:running_task, a:id)
  endif
  call coc#rpc#notify('TaskExit', [a:id, a:code])
endfunction

function! s:on_stderr(id, msgs)
  if get(g:, 'coc_vim_leaving', 0) | return | endif
  if len(a:msgs)
    call coc#rpc#notify('TaskStderr', [a:id, a:msgs])
  endif
endfunction

function! s:on_stdout(id, msgs)
  if len(a:msgs)
    call coc#rpc#notify('TaskStdout', [a:id, a:msgs])
  endif
endfunction

function! coc#task#running(id)
  if !has_key(s:running_task, a:id) == 1
    return v:false
  endif
  let job = s:running_task[a:id]
  if s:is_vim
    let status = job_status(job)
    return status ==# 'run'
  endif
  let [code] = jobwait([job], 10)
  return code == -1
endfunction
