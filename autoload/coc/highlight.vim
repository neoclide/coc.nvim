scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:diagnostic_hlgroups = ['CocErrorHighlight', 'CocWarningHighlight', 'CocInfoHighlight', 'CocHintHighlight', 'CocDeprecatedHighlight', 'CocUnusedHighlight']
" Maximum count to highlight each time.
let g:coc_highlight_maximum_count = get(g:, 'coc_highlight_maximum_count', 500)

" Update buffer region by region.
function! coc#highlight#buffer_update(bufnr, key, highlights, ...) abort
  if !bufloaded(a:bufnr)
    return
  endif
  if empty(a:highlights)
    call coc#highlight#clear_highlight(a:bufnr, a:key, 0, -1)
    return
  endif
  let priority = get(a:, 1, v:null)
  let changedtick = getbufvar(a:bufnr, 'changedtick', 0)
  if type(get(a:, 2, v:null)) == v:t_number && changedtick > a:2
    return
  endif
  let hls = map(copy(a:highlights), "{'hlGroup':v:val[0],'lnum':v:val[1],'colStart':v:val[2],'colEnd':v:val[3],'combine':get(v:val,4,1),'start_incl':get(v:val,5,0),'end_incl':get(v:val,6,0)}")
  if len(hls) <= g:coc_highlight_maximum_count
    call coc#highlight#update_highlights(a:bufnr, a:key, hls, 0, -1, priority)
    return
  endif
  let linecount = coc#compat#buf_line_count(a:bufnr)
  let groups = s:group_hls(hls, linecount)
  call s:update_highlights_timer(a:bufnr, changedtick, a:key, priority, groups, 0)
endfunction

" Update highlights by check exists highlights.
" 0 based, end exclusive start and end
function! coc#highlight#update_highlights(bufnr, key, highlights, ...) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let start = get(a:, 1, 0)
  let end = get(a:, 2, -1)
  if end == 0
    return
  endif
  let linecount = coc#compat#buf_line_count(a:bufnr)
  if end >= linecount
    let end = -1
  endif
  if empty(a:highlights)
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
    return
  endif
  let priority = get(a:, 3, v:null)
  let total = len(a:highlights)
  " index list that exists with current highlights
  let exists = []
  let ns = coc#highlight#create_namespace(a:key)
  if has('nvim') || exists('*prop_list')
    let endLnum = end < 0 ? linecount - 1 : end - 1
    let firstLnum = a:highlights[0]['lnum']
    if firstLnum > start
      call coc#highlight#clear_highlight(bufnr, a:key, start, firstLnum)
      let start = firstLnum
    endif
    let lastLnum = a:highlights[total - 1]['lnum']
    if lastLnum < endLnum
      call coc#highlight#clear_highlight(bufnr, a:key, lastLnum + 1, endLnum + 1)
      let endLnum = lastLnum
    endif
    let current = coc#highlight#get_highlights(bufnr, a:key, start, endLnum)
    let currIndex = 0
    if !empty(current)
      for [lnum, items] in s:to_group(current)
        let indexes = []
        let currIndexes = range(0, len(items) - 1)
        let removeIndexes = []
        while currIndex != total
          let hi = a:highlights[currIndex]
          if hi['lnum'] == lnum
            let findIndex = -1
            for idx in currIndexes
              let item = items[idx]
              if hi['hlGroup'] ==# item[0] && hi['colStart'] == item[2] && hi['colEnd'] == item[3]
                call add(indexes, currIndex)
                let findIndex = idx
                break
              elseif item[2] > hi['colStart']
                break
              endif
            endfor
            if findIndex != -1
              call filter(currIndexes, 'v:val != '.findIndex)
            endif
          elseif hi['lnum'] > lnum
            break
          endif
          let currIndex = currIndex + 1
        endwhile
        for idx in currIndexes
          if s:is_vim
            call prop_remove({'bufnr': bufnr, 'id': items[idx][4]})
          else
            call nvim_buf_del_extmark(bufnr, ns, items[idx][4])
          endif
        endfor
        call extend(exists, indexes)
      endfor
    endif
  else
    call coc#highlight#clear_highlight(bufnr, a:key, start, end)
  endif
  let indexes = range(0, total - 1)
  if !empty(exists)
    let indexes = filter(indexes, 'index(exists, v:val) == -1')
  endif
  for idx in indexes
    let hi = a:highlights[idx]
    let opts = {
        \ 'combine': get(hi, 'combine', 0),
        \ 'start_incl': get(hi, 'start_incl', 0),
        \ 'end_incl': get(hi, 'end_incl', 0),
        \ }
    if type(priority) == 0
      let opts['priority'] = s:get_priority(a:key, hi['hlGroup'], priority)
    endif
    call coc#highlight#add_highlight(bufnr, ns, hi['hlGroup'], hi['lnum'], hi['colStart'], hi['colEnd'], opts)
  endfor
endfunction

" Get list of highlights by range or all buffer.
" 0 based line, start_col and end_col
" 0 based start & end line, end inclusive.
function! coc#highlight#get_highlights(bufnr, key, ...) abort
  let start = get(a:, 1, 0)
  let end = get(a:, 2, -1)
  if s:is_vim
    return coc#vim9#Get_highlights(a:bufnr, a:key, start, end)
  endif
  return v:lua.require('coc.highlight').getHighlights(a:bufnr, a:key, start, end)
endfunction

" Add multiple highlights to buffer.
" type HighlightItem = [hlGroup, lnum, colStart, colEnd, combine?, start_incl?, end_incl?]
function! coc#highlight#set(bufnr, key, highlights, priority) abort
  if s:is_vim
    call coc#vim9#Set_highlights(a:bufnr, a:key, a:highlights, a:priority)
  else
    call v:lua.require('coc.highlight').set_highlights(a:bufnr, a:key, a:highlights, a:priority)
  endif
endfunction

function! coc#highlight#del_markers(bufnr, key, ids) abort
  if s:is_vim
    call coc#vim9#Del_markers(a:bufnr, a:ids)
  else
    call v:lua.require('coc.highlight').del_markers(a:bufnr, a:key, a:ids)
  endif
endfunction

function! coc#highlight#clear_highlight(bufnr, key, start_line, end_line) abort
  if s:is_vim
    call coc#vim9#Clear_highlights(a:bufnr, a:key, a:start_line, a:end_line)
  else
    call v:lua.require('coc.highlight').clear_highlights(a:bufnr, a:key, a:start_line, a:end_line)
  endif
endfunction

" highlight LSP range, opts contains 'combine' 'priority' 'start_incl' 'end_incl'
function! coc#highlight#ranges(bufnr, key, hlGroup, ranges, ...) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  if !bufloaded(bufnr)
    return
  endif
  let opts = get(a:, 1, {})
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
      let line = get(getbufline(bufnr, lnum), 0, '')
      if empty(line)
        continue
      endif
      if start['character'] > synmaxcol || end['character'] > synmaxcol
        continue
      endif
      let colStart = lnum == start['line'] + 1 ? coc#string#byte_index(line, start['character']) : 0
      let colEnd = lnum == end['line'] + 1 ? coc#string#byte_index(line, end['character']) : strlen(line)
      if colStart == colEnd
        continue
      endif
      call coc#highlight#add_highlight(bufnr, srcId, a:hlGroup, lnum - 1, colStart, colEnd, opts)
    endfor
  endfor
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
  if get(g:, 'coc_node_env', '') ==# 'test'
    call setwinvar(a:winid, 'highlights', a:highlights)
  endif
  " clear highlights
  call win_execute(a:winid, 'syntax clear')
  let bufnr = winbufnr(a:winid)
  call coc#highlight#clear_highlight(bufnr, -1, 0, -1)
  if !empty(a:codes)
    call coc#highlight#highlight_lines(a:winid, a:codes)
  endif
  if !empty(a:highlights)
    for item in a:highlights
      let hlGroup = item['hlGroup']
      let opts = hlGroup =~# 'Search$' ? {'priority': 999, 'combine': 1} : {}
      call coc#highlight#add_highlight(bufnr, -1, hlGroup, item['lnum'], item['colStart'], item['colEnd'])
    endfor
  endif
endfunction


" Add highlights to line groups of winid, support hlGroup and filetype
" config should have startLine, endLine (0 based, end excluded) and filetype or hlGroup
" endLine should > startLine and endLine is excluded
"
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#highlight_lines(winid, blocks) abort
  let region_id = 1
  let defined = []
  let cmds = []
  for config in a:blocks
    let start = config['startLine'] + 1
    let end = config['endLine'] == -1 ? len(getbufline(winbufnr(a:winid), 1, '$')) + 1 : config['endLine'] + 1
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call add(cmds, 'syntax region '.hlGroup.' start=/\%'.start.'l/ end=/\%'.end.'l/')
    else
      let filetype = matchstr(filetype, '\v^\w+')
      if empty(filetype) || filetype == 'txt' || index(get(g:, 'coc_markdown_disabled_languages', []), filetype) != -1
        continue
      endif
      if index(defined, filetype) == -1
        call add(cmds, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        call add(cmds, 'unlet! b:current_syntax')
        call add(defined, filetype)
      endif
      call add(cmds, 'syntax region CodeBlock'.region_id.' start=/\%'.start.'l/ end=/\%'.end.'l/ contains=@'.toupper(filetype).' keepend')
      let region_id = region_id + 1
    endif
  endfor
  if !empty(cmds)
    call win_execute(a:winid, cmds, 'silent!')
    let v:errmsg = ''
  endif
endfunction

" add matches for winid, use 0 for current window.
function! coc#highlight#match_ranges(winid, bufnr, ranges, hlGroup, priority) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  let bufnr = a:bufnr == 0 ? winbufnr(winid) : a:bufnr
  if empty(getwininfo(winid)) || (a:bufnr != 0 && winbufnr(a:winid) != a:bufnr)
    " not valid
    return []
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
      let colStart = lnum == start['line'] + 1 ? coc#string#byte_index(line, start['character']) + 1 : 1
      let colEnd = lnum == end['line'] + 1 ? coc#string#byte_index(line, end['character']) + 1 : strlen(line) + 1
      if colStart == colEnd
        continue
      endif
      call add(pos, [lnum, colStart, colEnd - colStart])
    endfor
    if !empty(pos)
      let opts = {'window': a:winid}
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
  return ids
endfunction

" Clear matches by hlGroup regexp.
function! coc#highlight#clear_match_group(winid, match) abort
  let winid = a:winid == 0 ? win_getid() : a:winid
  if empty(getwininfo(winid))
    " not valid
    return
  endif
  let arr = filter(getmatches(winid), 'v:val["group"] =~# "'.a:match.'"')
  for item in arr
    call matchdelete(item['id'], winid)
  endfor
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#highlight#clear_matches(winid, ids)
  let winid = a:winid == 0 ? win_getid() : a:winid
  if !empty(getwininfo(winid))
    for id in a:ids
      try
        call matchdelete(id, winid)
      catch /^Vim\%((\a\+)\)\=:E803/
        " ignore
      endtry
    endfor
  endif
endfunction

function! coc#highlight#clear_all() abort
  let dict = coc#compat#call('get_namespaces', [])
  let bufnrs = map(getbufinfo({'bufloaded': 1}), 'v:val["bufnr"]')
  for [key, src_id] in items(dict)
    if key =~# '^coc-'
      for bufnr in bufnrs
        call coc#compat#call('buf_clear_namespace', [bufnr, src_id, 0, -1])
      endfor
    endif
  endfor
endfunction

function! coc#highlight#create_namespace(key) abort
  if type(a:key) == v:t_number
    return a:key
  endif
  return coc#compat#call('create_namespace', ['coc-'. a:key])
endfunction

function! s:update_highlights_timer(bufnr, changedtick, key, priority, groups, idx) abort
  if getbufvar(a:bufnr, 'changedtick', 0) != a:changedtick
    return
  endif
  let group = get(a:groups, a:idx, v:null)
  if empty(group)
    return
  endif
  if empty(group['highlights'])
    call coc#highlight#clear_highlight(a:bufnr, a:key, group['start'], group['end'])
  else
    call coc#highlight#update_highlights(a:bufnr, a:key, group['highlights'], group['start'], group['end'], a:priority)
  endif
  if a:idx < len(a:groups) - 1
    call timer_start(50, { -> s:update_highlights_timer(a:bufnr, a:changedtick, a:key, a:priority, a:groups, a:idx + 1)})
  endif
endfunction

function! s:to_group(items) abort
  let res = []
  let before = v:null
  for item in a:items
    if empty(before) || before[0] != item[1]
      let before = [item[1], [item]]
      call add(res, before)
    else
      call add(before[1], item)
    endif
  endfor
  return res
endfunction

function! s:get_priority(key, hlGroup, priority) abort
  if a:hlGroup ==# 'CocListSearch'
    return 2048
  endif
  if a:hlGroup ==# 'CocSearch'
    return 999
  endif
  if strpart(a:key, 0, 10) !=# 'diagnostic'
    return a:priority
  endif
  return a:priority - index(s:diagnostic_hlgroups, a:hlGroup)
endfunction

function! s:group_hls(hls, linecount) abort
  " start, end, highlights
  let groups = []
  if empty(a:hls)
    call add(groups, {'start': 0, 'end': a:linecount, 'highlights': []})
    return groups
  endif
  let start = 0
  let highlights = []
  let lastLnum = -1
  for item in a:hls
    let lnum = item['lnum']
    if lnum >= a:linecount
      break
    endif
    if len(highlights) < g:coc_highlight_maximum_count || lnum == lastLnum
      call add(highlights, item)
      let lastLnum = lnum
    else
      call add(groups, {'start': start, 'end': lastLnum + 1, 'highlights': highlights})
      let highlights = []
      let start = lastLnum + 1
      call add(highlights, item)
      let lastLnum = lnum
    endif
  endfor
  call add(groups, {'start': start, 'end': a:linecount, 'highlights': highlights})
  return groups
endfunction

function! coc#highlight#add_highlight(bufnr, src_id, hl_group, line, col_start, col_end, ...) abort
  let src_id = a:src_id == -1 ? coc#compat#call('create_namespace', ['']) : a:src_id
  let opts = get(a:, 1, {})
  if s:is_vim
    call coc#api#Buf_add_highlight(a:bufnr, src_id, a:hl_group, a:line, a:col_start, a:col_end, opts)
  else
    let priority = get(opts, 'priority', v:null)
    let col_end = a:col_end == -1 ? strlen(get(getbufline(a:bufnr, a:line + 1), 0, '')) : a:col_end
    try
      call nvim_buf_set_extmark(a:bufnr, src_id, a:line, a:col_start, {
            \ 'end_col': col_end,
            \ 'hl_group': a:hl_group,
            \ 'hl_mode': get(opts, 'combine', 1) ? 'combine' : 'replace',
            \ 'right_gravity': v:true,
            \ 'end_right_gravity': v:false,
            \ 'priority': type(priority) == v:t_number ?  min([priority, 4096]) : 4096,
            \ })
    catch /^Vim\%((\a\+)\)\=:E5555/
    " the end_col could be invalid, ignore this error
    endtry
  endif
endfunction
