function! s:checkEnvironment() abort
  let valid = 1
  if !has('nvim') || !has('nvim-0.2.2')
    let valid = 0
    call health#report_error('Neovim version not satisfied, 0.2.2 and above required')
  endif
  if !executable('node') || !executable('npm')
    let valid = 0
    call health#report_error('Environment node.js not found, install node.js from http://nodejs.org/')
  endif
  let output = system('node -v')
  if v:shell_error && output !=# ""
    echohl Error | echon output | echohl None
    return
  endif
  let ms = matchlist(output, '^v\(\d\+\)')
  if empty(ms) || str2nr(ms[1]) < 8
    let valid = 0
    call health#report_error('Node.js version '.output.' too low, consider upgrade node.js')
  endif
  if valid
    call health#report_ok('Environment check passed')
  endif
  return valid
endfunction

function! s:checkInitailize() abort
  if get(g:, 'complete_node_initailized', 0)
    call health#report_ok('Service initailized')
    return 1
  endif
  call health#report_error('service could not be initailized', [
        \ 'To get the detail information'
        \ 'set environment variable $NVIM_COMPLETE_LOG_FILE to a log file'
        \ 'and restart your neovim'
        \])
  return 0
endfunction

function! health#complete#check() abort
    call s:checkEnvironment()
    let valid = s:checkInitailize()
    if valid
      let names = CompleteCheck()
      if !empty(names)
        call health#report_ok('Vim sources '.join(names, ',').' activted')
      endif
    endif
endfunction

