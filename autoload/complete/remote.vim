let s:timer_map = {}

" run complete for a specified source
function! complete#remote#do_complete(name, opt)
  let handler = 'complete#source#'.a:name.'#complete'
  if !exists('*'.handler)
    echoerr 'complete handler not found from source '.a:name
    return
  endif
  let OneTime = complete#util#once(funcref('s:OnCompletionReceived', [a:name, a:opt]))
  " try finish job after 1s
  let cid = call(handler, [a:opt, OneTime])
  "if type(cid) == 0 && cid > 0 " valid channel id
  "  let tid = timer_start(1000, funcref('s:TimerCallback', [cid]))
  "  let s:timer_map[a:name] = tid
  "endif
endfunction

function! s:TimerCallback(job_id, ...)
  let res = jobwait([a:job_id], 0)
  if res[0] === -1
    call jobstop(job_id)
  endif
endfunction

function! s:OnCompletionReceived(name, opt, items)
  let g:i = a:items
  call CompleteResult(a:opt.id, a:name, a:items)
  let tid = get(s:timer_map, a:name, 0)
  if tid
    try
      call timer_stop(tid)
    catch /.*/
    endtry
  endif
endfunction
