
function! complete#util#get_buflist() abort
  let buflist = []
  for i in range(tabpagenr('$'))
    call extend(buflist, tabpagebuflist(i + 1))
  endfor
  return buflist
endfunction

function! complete#util#print_errors(list) abort
  execute 'keepalt below 4new [Sketch File]'
  let lines = copy(a:list)
  call setline(1, '[complete.nvim] Error occored:')
  call setline(2, lines[0])
  call append(2, lines[1:])
  setl buftype=nofile bufhidden=wipe nobuflisted readonly
endfunction

" make function that only trigger once
function! complete#util#once(callback) abort
  function! Cb(...) dict
    if self.called == 1 | return | endif
    let self.called = 1
    call call(self.fn, a:000)
  endfunction

  let obj = {
        \'called': 0,
        \'fn': a:callback,
        \'callback': funcref('Cb'),
        \}
  return obj['callback']
endfunction
