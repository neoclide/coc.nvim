let s:is_win = has("win32") || has('win64')

function! coc#util#echo_messages(hl, msgs)
  if empty(a:msgs) | return | endif
  execute 'echohl '.a:hl
    for msg in a:msgs
      echom msg
    endfor
  echohl None
endfunction

function! coc#util#get_fullpath(bufnr) abort
  let fname = bufname(a:bufnr)
  if empty(fname) | return '' | endif
  return resolve(fnamemodify(fname, ':p'))
endfunction

function! coc#util#get_bufinfo(bufnr) abort
  return {
        \ 'bufnr': a:bufnr,
        \ 'fullpath': coc#util#get_fullpath(a:bufnr),
        \ 'languageId': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'expandtab': getbufvar(a:bufnr, '&expandtab') == 1 ? v:true : v:false,
        \ 'tabstop': getbufvar(a:bufnr, '&tabstop'),
        \}
endfunction

function! coc#util#get_buflist() abort
  let buflist = []
  for i in range(tabpagenr('$'))
    call extend(buflist, tabpagebuflist(i + 1))
  endfor
  return buflist
endfunction

function! coc#util#get_filetypes() abort
  let res = []
  for i in range(tabpagenr('$'))
    for bnr in tabpagebuflist(i + 1)
      let filetype = getbufvar(bnr, "&filetype")
      if index(res, filetype) == -1
        call add(res, filetype)
      endif
    endfor
  endfor
  return res
endfunction

function! coc#util#on_error(msg) abort
  echohl Error | echom '[coc.nvim] '.a:msg | echohl None
endfunction

" make function that only trigger once
function! coc#util#once(callback) abort
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

function! coc#util#check_state() abort
  return get(g:, 'coc_node_channel_id', 0)
endfunction

function! coc#util#get_listfile_command() abort
  if executable('rg')
    return 'rg --color never --files'
  endif
  if executable('ag')
    return 'ag --follow --nogroup --nocolor -g .'
  endif
  return ''
endfunction

function! coc#util#preview_info(info) abort
  pclose
  keepalt new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap [Document]
  setl bufhidden=wipe
  setl nobuflisted
  setl filetype=markdown
  setl nospell
  let lines = split(a:info, "\n")
  call append(0, lines)
  exe "normal z" . len(lines) . "\<cr>"
  exe "normal gg"
  wincmd p
endfunction

function! coc#util#get_queryoption() abort
  let [_, lnum, colnr, offset] = getpos('.')
  let dict = {
        \ 'filetype': &filetype,
        \ 'filename': expand('%:p'),
        \ 'col': colnr,
        \ 'lnum': lnum,
        \ 'content': join(getline(1, '$'), "\n"),
        \}
  return dict
endfunction

function! coc#util#jump_to(filepath, lnum, col) abort
  if empty(a:filepath)
    return
  endif
  let lnum = a:lnum + 1
  let col = a:col + 1
  normal! m`
  if a:filepath !=# expand('%:p')
    try
      exec 'keepjumps e ' . fnameescape(a:filepath)
    catch /^Vim\%((\a\+)\)\=:E37/
      " When the buffer is not saved, E37 is thrown.  We can ignore it.
    endtry
  endif
  call cursor(lnum, col)
  normal! zz
endfunction

function! coc#util#get_config_home()
  if exists('$VIMCONFIG')
    return resolve($VIMCONFIG)
  endif
  if exists('$XDG_CONFIG_HOME')
    return resolve($XDG_CONFIG_HOME."/nvim")
  endif
  return $HOME.'/.vim'
endfunction

function! coc#util#get_input()
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  return pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
endfunction

function! coc#util#get_complete_option(...)
  let opt = get(a:, 1, {})
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
  return extend({
        \ 'id': localtime(),
        \ 'changedtick': b:changedtick,
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': line,
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
        \ 'iskeyword': &iskeyword,
        \}, opt)
endfunction

function! coc#util#prompt_change(count)
  echohl MoreMsg
  echom a:count.' files will be saved. Confirm? (y/n)'
  echohl None
  let confirm = nr2char(getchar()) | redraw!
  if !(confirm ==? "y" || confirm ==? "\r")
    echohl Moremsg | echo 'Cancelled.' | echohl None
    return 0
  end
  return 1
endfunction

function! coc#util#get_syntax_name(lnum, col)
  return synIDattr(synIDtrans(synID(a:lnum,a:col,1)),"name")
endfunction

function! coc#util#get_search(col)
  let line = getline('.')
  let colnr = col('.')
  if colnr <= a:col + 1 | return '' | endif
  return line[a:col : colnr - 2]
endfunction
