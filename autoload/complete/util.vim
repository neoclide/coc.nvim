
function! complete#util#print_error(msg) abort
  execute "echoerr '".substitute(a:msg, "'", "''", 'g')."'"
endfunction

function! complete#util#print_errors(list)
  execute 'keepalt below 4new [Sketch File]'
  let lines = copy(a:list)
  call setline(1, 'Error occored in complete.nvim:')
  call setline(2, lines[0])
  call append(2, lines[1:])
  setl buftype=nofile bufhidden=wipe nobuflisted readonly
endfunction

" make function that only trigger once
function! complete#util#once(callback)
    function! Cb(...) dict
    if self.called | return | endif
    let self.called = 1
    call call(self.fn, a:000)
  endfunction

  let obj = {
        \'called': 0,
        \'fn': a:callback,
        \'callback': function('Cb'),
        \}
  return obj['callback']
endfunction
