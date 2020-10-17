" Related to float window create
let s:is_vim = !has('nvim')
let s:borderchars = get(g:, 'coc_borderchars',
      \ ['─', '│', '─', '│', '┌', '┐', '┘', '└'])
let s:prompt_win_width = get(g:, 'coc_prompt_win_width', 30)

function! coc#float#get_float_mode(allow_selection, align_top, pum_align_top) abort
  let mode = mode()
  if pumvisible() && a:align_top == a:pum_align_top
    return v:null
  endif
  let checked = (mode == 's' && a:allow_selection) || index(['i', 'n', 'ic'], mode) != -1
  if !checked
    return v:null
  endif
  if !s:is_vim && mode ==# 'i'
    " helps to fix undo issue, don't know why.
    call feedkeys("\<C-g>u", 'n')
  endif
  let pos = s:win_position()
  let viewport = {'lines': &lines, 'columns': &columns, 'cmdheight': &cmdheight}
  return [mode, bufnr('%'), pos, [line('.'), col('.')], viewport]
endfunction

" create/reuse float window for config position.
function! coc#float#create_float_win(winid, bufnr, config) abort
  let border_winid = 0
  " use exists
  if a:winid && coc#float#valid(a:winid)
    if s:is_vim
      let [line, col] = s:popup_position(a:config)
      call popup_move(a:winid, {
            \ 'line': line,
            \ 'col': col,
            \ 'minwidth': a:config['width'] - 2,
            \ 'minheight': a:config['height'],
            \ 'maxwidth': a:config['width'] - 2,
            \ 'maxheight': a:config['height'],
            \ })
      let opts = {
            \ 'cursorline': get(a:config, 'cursorline', 0),
            \ 'title': get(a:config, 'title', ''),
            \ }
      if !empty(opts['title'])
        let opts['border'] = []
      elseif has_key(a:config, 'border')
        let opts['border'] = a:config['border']
      endif
      call popup_setoptions(a:winid, opts)
      return [a:winid, winbufnr(a:winid)]
    else
      let config = coc#helper#dict_omit(a:config, ['title', 'border', 'cursorline'])
      call nvim_win_set_config(a:winid, config)
      " can't reuse border window
      if has_key(a:config, 'border')
        let border_winid = coc#float#create_border_win(a:config)
      endif
      return [a:winid, winbufnr(a:winid), border_winid]
    endif
  endif
  let winid = 0
  let title = get(a:config, 'title', v:null)
  if s:is_vim
    let [line, col] = s:popup_position(a:config)
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let opts = {
          \ 'padding': empty(title) ?  [0, 1, 0, 1] : [0, 0, 0, 0],
          \ 'highlight': 'CocFloating',
          \ 'fixed': 1,
          \ 'cursorline': get(a:config, 'cursorline', 0),
          \ 'line': line,
          \ 'col': col,
          \ 'minwidth': a:config['width'] - 2,
          \ 'minheight': a:config['height'],
          \ 'maxwidth': a:config['width'] - 2,
          \ 'maxheight': a:config['height'],
          \ }
    if !empty(title)
      let opts['title'] = title
      let opts['border'] = get(a:config, 'border', [])
      let opts['borderchars'] = s:borderchars
    endif
    let winid = popup_create(bufnr, opts)
    if has("patch-8.1.2281")
      call setwinvar(winid, 'showbreak', 'NONE')
    endif
  else
    " Note that width is total width, but height is content height
    let config = coc#helper#dict_omit(a:config, ['title', 'border', 'cursorline'])
    let border = has_key(a:config, 'border')
    if border
      if config['relative'] ==# 'cursor' && config['row'] < 0
        " move top
        let config['row'] = config['row'] - 1
      else
        " move down
        let config['row'] = config['row'] + 1
      endif
      let config['width'] = config['width'] - 2
      let config['col'] = config['col'] + 1
      " create border window
    endif
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let winid = nvim_open_win(bufnr, 0, config)
    call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating,CursorLine:CocMenuSel')
    call setwinvar(winid, '&signcolumn', 'no')
    if !border
      call setwinvar(winid, '&foldcolumn', 1)
    else
      let c = extend({}, a:config)
      let c['row'] = config['row'] - 1
      let border_winid = coc#float#create_border_win(c)
    endif
  endif
  if winid <= 0
    return null
  endif
  if !s:is_vim
    " change cursorline option affects vim's own highlight
    call setwinvar(winid, '&cursorline', get(a:config, 'cursorline', 0))
  endif
  call setwinvar(winid, '&list', 0)
  call setwinvar(winid, '&number', 0)
  call setwinvar(winid, '&relativenumber', 0)
  call setwinvar(winid, '&cursorcolumn', 0)
  call setwinvar(winid, '&colorcolumn', 0)
  if s:is_vim || has('nvim-0.5.0')
    call setwinvar(winid, '&scrolloff', 0)
  endif
  call setwinvar(winid, 'float', 1)
  call setwinvar(winid, '&wrap', 1)
  call setwinvar(winid, '&linebreak', 1)
  call setwinvar(winid, '&conceallevel', 2)
  let g:coc_last_float_win = winid
  call coc#util#do_autocmd('CocOpenFloat')
  return [winid, winbufnr(winid), border_winid]
endfunction

function! coc#float#valid(winid) abort
  if a:winid == 0 || type(a:winid) != 0
    return 0
  endif
  if s:is_vim
    return s:popup_visible(a:winid)
  elseif exists('*nvim_win_is_valid') && nvim_win_is_valid(a:winid)
    let config = nvim_win_get_config(a:winid)
    return !empty(get(config, 'relative', ''))
  endif
  return 0
endfunction

" create buffer for popup/float window
function! coc#float#create_float_buf(bufnr) abort
  " reuse buffer cause error on vim8
  if a:bufnr && bufloaded(a:bufnr)
    return a:bufnr
  endif
  if s:is_vim
    noa let bufnr = bufadd('')
    noa call bufload(bufnr)
  else
    noa let bufnr = nvim_create_buf(v:false, v:true)
  endif
  " Don't use popup filetype, it would crash on reuse!
  call setbufvar(bufnr, '&buftype', 'nofile')
  call setbufvar(bufnr, '&bufhidden', 'hide')
  call setbufvar(bufnr, '&swapfile', 0)
  call setbufvar(bufnr, '&tabstop', 2)
  call setbufvar(bufnr, '&undolevels', -1)
  return bufnr
endfunction

" border window for neovim
function! coc#float#create_border_win(config) abort
  " width height col row relative
  noa let bufnr = nvim_create_buf(v:false, v:true)
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  let winid = nvim_open_win(bufnr, 0, {
        \ 'relative': a:config['relative'],
        \ 'width': a:config['width'],
        \ 'height': a:config['height'] + 2,
        \ 'row': a:config['row'],
        \ 'col': a:config['col'],
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ })
  call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
  call setwinvar(winid, '&signcolumn', 'no')
  let lines = coc#float#create_border_lines(get(a:config, 'title', ''), a:config['width'] - 2, a:config['height'])
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
  return winid
endfunction

function! coc#float#create_border_lines(title, width, height) abort
  let top = s:borderchars[4].repeat(s:borderchars[0], a:width).s:borderchars[5]
  let mid = s:borderchars[3].repeat(' ', a:width).s:borderchars[1]
  let bot = s:borderchars[7].repeat(s:borderchars[2], a:width).s:borderchars[6]
  if !empty(a:title)
    let top = coc#helper#str_compose(top, 1, a:title)
  endif
  return [top] + repeat([mid], a:height) + [bot]
endfunction

" Create float window for input
function! coc#float#create_prompt_win(title, default) abort
  if !has('nvim-0.5.0')
    return []
  endif
  let bufnr = nvim_create_buf(v:false, v:true)
  call setbufvar(bufnr, '&buftype', 'prompt')
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  call setbufvar(bufnr, '&undolevels', -1)
  call setbufvar(bufnr, 'coc_suggest_disable', 1)
  " Calculate col
  let curr = win_screenpos(winnr())[1] + wincol() - 2
  if s:prompt_win_width > &columns
    let col = 0
    let s:prompt_win_width = &columns
  else
    let col = curr + s:prompt_win_width < &columns ? 0 : &columns - s:prompt_win_width
  endif
  let winid = nvim_open_win(bufnr, 0, {
        \ 'relative': 'cursor',
        \ 'width': s:prompt_win_width - 2,
        \ 'height': 1,
        \ 'row': 0,
        \ 'col': col + 1,
        \ 'style': 'minimal',
        \ })
  if winid == 0
    return []
  endif
  call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
  let border_winid = coc#float#create_border_win({
        \ 'title': a:title,
        \ 'relative': 'cursor',
        \ 'width': s:prompt_win_width,
        \ 'height': 1,
        \ 'row': -1,
        \ 'col': col,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ })
  call win_gotoid(winid)
  call prompt_setprompt(bufnr,'')
  call prompt_setcallback(bufnr, {text -> coc#rpc#notify('PromptInsert', [text, bufnr])})
  call prompt_setinterrupt(bufnr, { -> execute(['bd! '.bufnr, 'call coc#float#close('.border_winid.')'], 'silent!')})
  startinsert
  call feedkeys(a:default, 'in')
  return [bufnr, winid, border_winid]
endfunction

" Position of cursor relative to editor
function! s:win_position() abort
  let nr = winnr()
  let [row, col] = win_screenpos(nr)
  return [row + winline() - 2, col + wincol() - 2]
endfunction

" get popup position for vim8 based on config of neovim float window
function! s:popup_position(config) abort
  let relative = get(a:config, 'relative', 'editor')
  if relative ==# 'cursor'
    return [s:popup_cursor(a:config['row']), s:popup_cursor(a:config['col'])]
  endif
  return [a:config['row'] + 1, a:config['col'] + 1]
endfunction

function! s:popup_cursor(n) abort
  if a:n == 0
    return 'cursor'
  endif
  if a:n < 0
    return 'cursor'.a:n
  endif
  return 'cursor+'.a:n
endfunction

" Close float window by id
function! coc#float#close(winid) abort
  if !coc#float#valid(a:winid)
    return 0
  endif
  if s:is_vim
    call popup_close(a:winid)
    return 1
  else
    call nvim_win_close(a:winid, 1)
    return 1
  endif
  return 0
endfunction

" Float window id on current tab.
" return 0 if not found
function! coc#float#get_float_win() abort
  if has('nvim')
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      if (!empty(get(nvim_win_get_config(id), 'relative', '')))
        return id
      endif
    endfor
  elseif exists('*popup_list')
    let arr = filter(popup_list(), 'popup_getpos(v:val)["visible"]')
    if !empty(arr)
      return arr[0]
    endif
  endif
  return 0
endfunction

function! coc#float#get_float_win_list() abort
  if s:is_vim && exists('*popup_list')
    return filter(popup_list(), 'popup_getpos(v:val)["visible"]')
  elseif has('nvim') && exists('*nvim_win_get_config')
    let res = []
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      " ignore border & scratch window
      if (!empty(config) && config['focusable'] == v:true && !empty(config['relative']))
        if !getwinvar(id, 'scratch', 0)
          call add(res, id)
        endif
      endif
    endfor
    return res
  endif
  return []
endfunction

" Check if a float window is scrollable
function! coc#float#scrollable(winid) abort
  let bufnr = winbufnr(a:winid)
  if bufnr == -1
    return 0
  endif
  if s:is_vim
    let pos = popup_getpos(a:winid)
    " scrollbar enabled
    if get(popup_getoptions(a:winid), 'scrollbar', 0)
      return get(pos, 'scrollbar', 0)
    endif
    if !getwinvar(a:winid, '&wrap')
      return line('$', a:winid) > pos['core_height']
    endif
    let total = 0
    let width = pos['core_width']
    for line in getbufline(winbufnr(a:winid), 1, '$')
      let dw = strdisplaywidth(line)
      let total += float2nr(ceil(str2float(string(dw))/width))
    endfor
    return total > pos['core_height']
  endif
  let height = nvim_win_get_height(a:winid)
  let width = nvim_win_get_width(a:winid)
  let wrap = getwinvar(a:winid, '&wrap')
  let linecount = nvim_buf_line_count(bufnr)
  if !wrap
    return linecount > height
  endif
  let total = 0
  for line in nvim_buf_get_lines(bufnr, 0, -1, 0)
    let dw = strdisplaywidth(line)
    let total += float2nr(ceil(str2float(string(dw))/width))
  endfor
  return total > height
endfunction

function! coc#float#has_scroll() abort
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  return !empty(win_ids)
endfunction

function! coc#float#scroll(forward)
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  if empty(win_ids)
    return ''
  endif
  if has('nvim')
    call timer_start(10, { -> s:scroll_nvim(win_ids, a:forward)})
  else
    call timer_start(10, { -> s:scroll_vim(win_ids, a:forward)})
  endif
  return "\<Ignore>"
endfunction

function! s:scroll_nvim(win_ids, forward) abort
  let curr = win_getid()
  for id in a:win_ids
    if nvim_win_is_valid(id)
      let wrapped = 0
      if getwinvar(id, '&wrap', 0)
        let width = nvim_win_get_width(id)
        if type(getwinvar(id, 'border', v:null)) == 7
          " since we use foldcolumn for left pading
          let width = width - 1
        endif
        for line in nvim_buf_get_lines(winbufnr(id), 0, -1, v:false)
          if strdisplaywidth(line) > width
            let wrapped = 1
            break
          endif
        endfor
      endif
      noa call win_gotoid(id)
      if wrapped
        let delta = nvim_win_get_height(id)
        if a:forward
          execute 'noa normal! '.delta.'gj'
        else
          execute 'noa normal! '.delta.'gk'
        endif
      else
        let firstline = line('w0')
        let lastline = line('w$')
        let linecount = line('$')
        if firstline == 1 && !a:forward
          continue
        endif
        if lastline == linecount && a:forward
          continue
        endif
        if a:forward
          call nvim_win_set_cursor(id, [lastline, 0])
          execute 'normal! zt'
        else
          call nvim_win_set_cursor(id, [firstline, 0])
          execute 'normal! zb'
        endif
      endif
    endif
  endfor
  noa call win_gotoid(curr)
  redraw
endfunction

function! s:scroll_vim(win_ids, forward) abort
  for id in a:win_ids
    if s:popup_visible(id)
      let pos = popup_getpos(id)
      let bufnr = winbufnr(id)
      let linecount = get(getbufinfo(bufnr)[0], 'linecount', 0)
      " for forward use last line (or last line + 1) as first line
      if a:forward
        if pos['firstline'] == pos['lastline']
          if pos['firstline'] == linecount
            return
          endif
          call popup_setoptions(id, {'firstline': pos['firstline'] + 1})
        else
          if pos['lastline'] == linecount
            let win_width = pos['core_width']
            let text = getbufline(bufnr, '$')[0]
            if strdisplaywidth(text) <= win_width
              " last line shown
              return
            endif
          endif
          call popup_setoptions(id, {'firstline': pos['lastline']})
        endif
      else
        if pos['firstline'] == 1
          call win_execute(id, 'normal! gg0')
          return
        endif
        " we could only change firstline
        " iterate lines before last lines to fill content height - 1
        let total_height = pos['core_height'] - 1
        if total_height == 0
          call popup_setoptions(id, {'firstline': pos['firstline'] - 1})
        else
          let lines = getbufline(bufnr, 1, '$')
          let curr = pos['firstline'] - 1
          let width = pos['core_width']
          let used = 0
          while v:true
            if curr == 1
              break
            endif
            let w = strdisplaywidth(lines[curr - 1])
            let used += float2nr(ceil(str2float(string(w))/width))
            if used > total_height
              let curr = curr == pos['firstline'] -1 ? curr : curr + 1
              break
            elseif used == total_height
              break
            endif
            let curr = curr - 1
          endwhile
          call popup_setoptions(id, {'firstline': curr})
        endif
      endif
    endif
  endfor
  redraw
endfunction

function! s:popup_visible(id) abort
  let pos = popup_getpos(a:id)
  if !empty(pos) && get(pos, 'visible', 0)
    return 1
  endif
  return 0
endfunction
