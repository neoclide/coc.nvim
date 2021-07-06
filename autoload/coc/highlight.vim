scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:clear_match_by_window = has('nvim-0.5.0') || has('patch-8.1.1084')
let s:prop_offset = get(g:, 'coc_text_prop_offset', 1000)
let s:namespace_map = {}
let s:ns_id = 1

if has('nvim-0.5.0')
  try
    call getmatches(0)
  catch /^Vim\%((\a\+)\)\=:E118/
    let s:clear_match_by_window = 0
  endtry
endif

" Update highlights by check exists highlights.
function! coc#highlight#update_highlights(bufnr, key, highlights) abort
  if !bufloaded(a:bufnr)
    return
  endif
  let total = len(a:highlights)
  if total == 0
    call coc#highlight#clear_highlight(a:bufnr, a:key, 0, -1)
    return
  endif
  " index list that exists with current highlights
  let exists = []
  let ns = coc#highlight#create_namespace(a:key)
  if has('nvim-0.5.0')
    " we have to compare line by line, since we can't clear highlight by id
    " line index => highlights
    let current = {}
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, 0, -1, {'details': v:true})
    let lines = getbufline(a:bufnr, 1, '$')
    for [_, line, start_col, details] in markers
      let text = lines[line]
      let delta = details['end_row'] - line
      if delta > 1 || (delta == 1 && details['end_col'] != 0)
        continue
      endif
      let curr = get(current, string(line), [])
      call add(curr, {
          \ 'hlGroup': details['hl_group'],
          \ 'lnum': line,
          \ 'colStart': start_col,
          \ 'colEnd': delta == 1 ? strlen(text) : details['end_col']
          \ })
      let current[line] = curr
    endfor
    let currIndex = 0
    for lnum in sort(keys(current))
      let items = current[lnum]
      let indexes = []
      for item in items
        if currIndex <= total - 1
          for i in range(currIndex, total - 1)
            let h = a:highlights[i]
            if coc#helper#obj_equal(item, h)
              call add(indexes, i)
            endif
          endfor
        endif
      endfor
      if len(indexes)
        let currIndex = max(indexes) + 1
      endif
      " all highlights of current line exists, not clear.
      if len(indexes) == len(items)
        let exists = exists + indexes
      else
        call nvim_buf_clear_namespace(a:bufnr, ns, str2nr(lnum), str2nr(lnum) + 1)
      endif
    endfor
  elseif exists('*prop_list')
    let id = s:prop_offset + ns
    " we could only get textprops line by line
    let lines = getbufline(a:bufnr, 1, '$')
    let linecount = len(lines)
    let currIndex = 0
    for line in range(1, linecount)
      let items = []
      for prop in prop_list(line, {'bufnr': a:bufnr, 'id': id})
        if prop['start'] == 0 || prop['end'] == 0
          " multi line tokens are not supported; simply ignore it
          continue
        endif
        call add(items, {
              \ 'hlGroup': s:prop_type_hlgroup(prop['type']),
              \ 'lnum': line - 1,
              \ 'colStart': prop['col'] - 1,
              \ 'colEnd': prop['col'] - 1 + prop['length'],
              \ })
      endfor
      if !len(items)
        continue
      endif
      let indexes = []
      for item in items
        if currIndex <= total - 1
          for i in range(currIndex, total - 1)
            let h = a:highlights[i]
            if coc#helper#obj_equal(item, h)
              call add(indexes, i)
            endif
          endfor
        endif
      endfor
      if len(indexes)
        let currIndex = max(indexes) + 1
      endif
      " all highlights of current line exists, not clear.
      if len(indexes) == len(items)
        let exists = exists + indexes
      else
        call prop_remove({'id': id, 'bufnr':a:bufnr}, line)
      endif
    endfor
  else
    call coc#highlight#clear_highlight(a:bufnr, a:key, 0, -1)
  endif
  let g:e = exists
  for i in range(0, total - 1)
    if index(exists, i) == -1
      let hi = a:highlights[i]
      call coc#highlight#add_highlight(a:bufnr, ns, hi['hlGroup'], hi['lnum'], hi['colStart'], hi['colEnd'])
    endif
  endfor
endfunction

function! coc#highlight#get_highlights(bufnr, key) abort
  if !has_key(s:namespace_map, a:key) || !bufloaded(a:bufnr)
    return []
  endif
  let res = []
  let ns = s:namespace_map[a:key]
  if exists('*prop_list')
    let lines = getbufline(a:bufnr, 1, '$')
    let linecount = len(lines)
    for line in range(1, linecount)
      for prop in prop_list(line, {'bufnr': a:bufnr, 'id': s:prop_offset + ns})
        if prop['start'] == 0 || prop['end'] == 0
          " multi line tokens are not supported; simply ignore it
          continue
        endif
        let text = lines[line - 1]
        call add(res, {
              \   'group': s:prop_type_hlgroup(prop['type']),
              \   'line': line - 1,
              \   'startCharacter': coc#helper#get_charactor(text, prop['col']),
              \   'endCharacter': coc#helper#get_charactor(text, prop['col'] + prop['length'])
              \ })
      endfor
    endfor
  elseif has('nvim-0.5.0')
    let markers = nvim_buf_get_extmarks(a:bufnr, ns, 0, -1, {'details': v:true})
    let lines = getbufline(a:bufnr, 1, '$')
    for [_, line, start_col, details] in markers
      let text = lines[line]
      let delta = details['end_row'] - line
      if delta > 1 || (delta == 1 && details['end_col'] != 0)
        " can't handle, single line only
        continue
      endif
      call add(res, {
            \   'group': details['hl_group'],
            \   "line": line,
            \   'startCharacter': coc#helper#get_charactor(text, start_col + 1),
            \   'endCharacter': delta == 1 ? strchars(text) : coc#helper#get_charactor(text, details['end_col'] + 1)
            \ })
    endfor
  else
    throw 'Get highlights requires neovim 0.5.0 or vim support prop_list'
  endif
  return res
endfunction

" highlight LSP range,
function! coc#highlight#ranges(bufnr, key, hlGroup, ranges) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr) || !exists('*getbufline')
    return
  endif
  let synmaxcol = getbufvar(a:bufnr, '&synmaxcol', 1000)
  if synmaxcol == 0
    let synmaxcol = 1000
  endif
  let synmaxcol = min([synmaxcol, 1000])
  let srcId = coc#highlight#create_namespace(a:key)
  for range in a:ranges
    let start = range['start']
    let end = range['end']
    for lnum in range(start['line'] + 1, end['line'] + 1)
      let arr = getbufline(bufnr, lnum)
      let line = empty(arr) ? '' : arr[0]
      if empty(line)
        continue
      endif
      if start['character'] > synmaxcol || end['character'] > synmaxcol
        continue
      endif
      " TODO don't know how to count UTF16 code point, should work most cases.
      let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) : 0
      let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) : -1
      if colStart == colEnd
        continue
      endif
      call coc#highlight#add_highlight(bufnr, srcId, a:hlGroup, lnum - 1, colStart, colEnd)
    endfor
  endfor
endfunction

function! coc#highlight#add_highlight(bufnr, src_id, hl_group, line, col_start, col_end) abort
  if has('nvim')
    call nvim_buf_add_highlight(a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end)
  else
    call coc#api#call('buf_add_highlight', [a:bufnr, a:src_id, a:hl_group, a:line, a:col_start, a:col_end])
  endif
endfunction

function! coc#highlight#clear_highlight(bufnr, key, start_line, end_line) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let src_id = coc#highlight#create_namespace(a:key)
  if has('nvim')
    call nvim_buf_clear_namespace(a:bufnr, src_id, a:start_line, a:end_line)
  else
    call coc#api#call('buf_clear_namespace', [a:bufnr, src_id, a:start_line, a:end_line])
  endif
endfunction

" highlight buffer in winid with CodeBlock &HighlightItems
" export interface HighlightItem {
"   lnum: number // 0 based
"   hlGroup: string
"   colStart: number // 0 based
"   colEnd: number
" }
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#add_highlights(winid, codes, highlights) abort
  " clear highlights
  call coc#compat#execute(a:winid, 'syntax clear')
  let bufnr = winbufnr(a:winid)
  call coc#highlight#clear_highlight(bufnr, -1, 0, -1)
  if !empty(a:codes)
    call coc#highlight#highlight_lines(a:winid, a:codes)
  endif
  if !empty(a:highlights)
    for item in a:highlights
      call coc#highlight#add_highlight(bufnr, -1, item['hlGroup'], item['lnum'], item['colStart'], item['colEnd'])
    endfor
  endif
endfunction


" Add highlights to line groups of winid, support hlGroup and filetype
" config should have startLine, endLine (1 based, end excluded) and filetype or hlGroup
" endLine should > startLine and endLine is excluded
"
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#highlight_lines(winid, blocks) abort
  let currwin = win_getid()
  let switch = has('nvim') && currwin != a:winid
  if switch
    noa call nvim_set_current_win(a:winid)
  endif
  let defined = []
  let region_id = 1
  for config in a:blocks
    let start = config['startLine'] + 1
    let end = config['endLine'] == -1 ? len(getbufline(winbufnr(a:winid), 1, '$')) + 1 : config['endLine'] + 1
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call s:execute(a:winid, 'syntax region '.hlGroup.' start=/\%'.start.'l/ end=/\%'.end.'l/')
    else
      let filetype = matchstr(filetype, '\v^\w+')
      if empty(filetype) || filetype == 'txt' || index(get(g:, 'coc_markdown_disabled_languages', []), filetype) != -1
        continue
      endif
      if index(defined, filetype) == -1
        call s:execute(a:winid, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        if has('nvim')
          unlet! b:current_syntax
        elseif exists('*win_execute')
          call win_execute(a:winid, 'unlet! b:current_syntax')
        endif
        call add(defined, filetype)
      endif
      call s:execute(a:winid, 'syntax region CodeBlock'.region_id.' start=/\%'.start.'l/ end=/\%'.end.'l/ contains=@'.toupper(filetype).' keepend')
      let region_id = region_id + 1
    endif
  endfor
  if switch
    noa call nvim_set_current_win(currwin)
  endif
endfunction

" Copmpose hlGroups with foreground and background colors.
function! coc#highlight#compose_hlgroup(fgGroup, bgGroup) abort
  let hlGroup = 'Fg'.a:fgGroup.'Bg'.a:bgGroup
  if a:fgGroup == a:bgGroup
    return a:fgGroup
  endif
  if hlexists(hlGroup)
    return hlGroup
  endif
  let fg = synIDattr(synIDtrans(hlID(a:fgGroup)), 'fg', 'gui')
  let bg = synIDattr(synIDtrans(hlID(a:bgGroup)), 'bg', 'gui')
  if fg =~# '^#' || bg =~# '^#'
    call s:create_gui_hlgroup(hlGroup, fg, bg, '')
  else
    let fg = synIDattr(synIDtrans(hlID(a:fgGroup)), 'fg', 'cterm')
    let bg = synIDattr(synIDtrans(hlID(a:bgGroup)), 'bg', 'cterm')
    call s:create_cterm_hlgroup(hlGroup, fg, bg, '')
  endif
  return hlGroup
endfunction

" add matches for winid, use 0 for current window.
function! coc#highlight#match_ranges(winid, bufnr, ranges, hlGroup, priority) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  let bufnr = a:bufnr == 0 ? winbufnr(winid) : a:bufnr
  if empty(getwininfo(winid)) || (a:bufnr != 0 && winbufnr(a:winid) != a:bufnr)
    " not valid
    return []
  endif
  if !s:clear_match_by_window
    let curr = win_getid()
    if has('nvim')
      noa call nvim_set_current_win(winid)
    else
      noa call win_gotoid(winid)
    endif
  endif
  let ids = []
  for range in a:ranges
    let pos = []
    let start = range['start']
    let end = range['end']
    for lnum in range(start['line'] + 1, end['line'] + 1)
      let arr = getbufline(bufnr, lnum)
      let line = empty(arr) ? '' : arr[0]
      if empty(line)
        continue
      endif
      let colStart = lnum == start['line'] + 1 ? strlen(strcharpart(line, 0, start['character'])) + 1 : 1
      let colEnd = lnum == end['line'] + 1 ? strlen(strcharpart(line, 0, end['character'])) + 1 : strlen(line) + 1
      if colStart == colEnd
        continue
      endif
      call add(pos, [lnum, colStart, colEnd - colStart])
    endfor
    if !empty(pos)
      let opts = s:clear_match_by_window ? {'window': a:winid} : {}
      let i = 1
      let l = []
      for p in pos
        call add(l, p)
        if i % 8 == 0
          let id = matchaddpos(a:hlGroup, l, a:priority, -1, opts)
          call add(ids, id)
          let l = []
        endif
        let i += 1
      endfor
      if !empty(l)
        let id = matchaddpos(a:hlGroup, l, a:priority, -1, opts)
        call add(ids, id)
      endif
    endif
  endfor
  if !s:clear_match_by_window
    if has('nvim')
      noa call nvim_set_current_win(curr)
    else
      noa call win_gotoid(curr)
    endif
  endif
  return ids
endfunction

" Clear matches by hlGroup regexp.
function! coc#highlight#clear_match_group(winid, match) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  if s:clear_match_by_window
    let arr = filter(getmatches(winid), 'v:val["group"] =~# "'.a:match.'"')
    for item in arr
      call matchdelete(item['id'], winid)
    endfor
  else
    let curr = win_getid()
    let switch = exists('*nvim_set_current_win') && curr != winid
    if switch
      noa call nvim_set_current_win(a:winid)
    endif
    if win_getid() == winid
      let arr = filter(getmatches(), 'v:val["group"] =~# "'.a:match.'"')
      for item in arr
        call matchdelete(item['id'])
      endfor
    endif
    if switch
      noa call nvim_set_current_win(curr)
    endif
  endif
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#highlight#clear_matches(winid, ids)
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  if s:clear_match_by_window
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /^Vim\%((\a\+)\)\=:E803/
        " ignore
      endtry
    endfor
  else
    let curr = win_getid()
    let switch = exists('*nvim_set_current_win') && curr != winid
    if switch
      noa call nvim_set_current_win(a:winid)
    endif
    if win_getid() == winid
      for id in a:ids
        try
          call matchdelete(id)
        catch /^Vim\%((\a\+)\)\=:E803/
          " ignore
        endtry
      endfor
    endif
    if switch
      noa call nvim_set_current_win(curr)
    endif
  endif
endfunction

" Sets the highlighting for the given group
function! s:create_gui_hlgroup(group, fg, bg, attr)
  if a:fg != ""
    exec "silent hi " . a:group . " guifg=" . a:fg . " ctermfg=" . coc#color#rgb2term(strpart(a:fg, 1))
  endif
  if a:bg != ""
    exec "silent hi " . a:group . " guibg=" . a:bg . " ctermbg=" . coc#color#rgb2term(strpart(a:bg, 1))
  endif
  if a:attr != ""
    exec "silent hi " . a:group . " gui=" . a:attr . " cterm=" . a:attr
  endif
endfun

function! s:create_cterm_hlgroup(group, fg, bg, attr) abort
  if a:fg != ""
    exec "silent hi " . a:group . " ctermfg=" . a:fg
  endif
  if a:bg != ""
    exec "silent hi " . a:group . " ctermbg=" . a:bg
  endif
  if a:attr != ""
    exec "silent hi " . a:group . " cterm=" . a:attr
  endif
endfunction

function! s:execute(winid, cmd) abort
  if has('nvim')
    execute 'silent! ' a:cmd
  else
    call win_execute(a:winid, a:cmd, 'silent!')
  endif
endfunction

function! s:prop_type_hlgroup(type) abort
  if a:type=~# '^CocHighlight'
    return a:type[12:]
  endif
  return prop_type_get(a:type)['highlight']
endfunction

function! coc#highlight#create_namespace(key) abort
  if type(a:key) == 0
    return a:key
  endif
  if has_key(s:namespace_map, a:key)
    return s:namespace_map[a:key]
  endif
  if has('nvim')
    let s:namespace_map[a:key] = nvim_create_namespace('coc-'.a:key)
  else
    let s:namespace_map[a:key] = s:ns_id
    let s:ns_id = s:ns_id + 1
  endif
  return s:namespace_map[a:key]
endfunction
