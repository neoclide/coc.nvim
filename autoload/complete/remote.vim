let s:timer_map = {}

" run complete for a specified source
function! complete#remote#do_complete(name, opt)
  let handler = 'complete#source#'.a:name.'#complete'
  if !exists('*'.handler)
    echoerr 'complete handler not found from source '.a:name
    return
  endif
  let OneTime = complete#util#once(funcref('s:OnCompletionReceived', [a:name, a:opt]))
  " finish job & invoke callback after 2s
  let cid = call(handler, [a:opt, OneTime])
  let cid = type(cid) == 0 && cid > 0 ? cid : 0
  let tid = timer_start(2000, funcref('s:TimerCallback', [cid, OneTime]))
  let s:timer_map[a:name] = tid
endfunction

function! s:TimerCallback(job_id, Handler,...)
  if a:job_id
    let res = jobwait([a:job_id], 20)
    if res[0] == -1
      try
        call jobstop(a:job_id)
      catch /.*/
      endtry
    endif
  endif
  call call(a:Handler, [[]])
endfunction

function! s:OnCompletionReceived(name, opt, items)
  call CompleteResult(a:opt.id, a:name, a:items)
  let tid = get(s:timer_map, a:name, 0)
  if tid
    try
      call timer_stop(tid)
    catch /.*/
    endtry
  endif
endfunction
