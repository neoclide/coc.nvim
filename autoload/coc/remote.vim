let s:timer_map = {}
let s:is_vim = !has('nvim')

" run complete for a specified source
function! coc#remote#do_complete(name, opt)
  let handler = 'coc#source#'.a:name.'#complete'
  if !exists('*'.handler)
    echoerr 'complete function not found from source '.a:name
    return
  endif
  let OneTime = coc#util#once(funcref('s:OnCompletionReceived', [a:name, a:opt]))
  " finish job & invoke callback after 3s
  let cid = call(handler, [a:opt, OneTime])
  if s:is_vim && type(cid) != 8
    return
  endif
  if has('nvim') && type(cid) != 0
    return
  endif
  let tid = timer_start(3000, funcref('s:TimerCallback', [cid, OneTime]))
  let s:timer_map[a:name] = tid
endfunction

function! s:TimerCallback(job, Handler,...)
  if s:is_vim
    let stat = job_status(a:job)
    if stat == 'run'
      call job_stop(a:job, 'kill')
    endif
    return
  endif
  if a:job
    let res = jobwait([a:job], 20)
    if res[0] == -1
      try
        call jobstop(a:job)
      catch /.*/
      endtry
    endif
  endif
  call call(a:Handler, [[]])
endfunction

function! s:OnCompletionReceived(name, opt, items)
  call coc#rpc#notify('CocResult', [a:opt.id, a:name, a:items])
  let tid = get(s:timer_map, a:name, 0)
  if tid 
    call remove(s:timer_map, a:name)
    call timer_stop(tid)
  endif
endfunction
