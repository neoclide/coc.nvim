let s:is_vim = !has('nvim')
let s:namespace = "coc-ns-semantic-highlights"

function! coc#semantic_highlight#prepare_highlight_groups(bufnr, groups) abort
  if s:is_vim
    for l:group in a:groups
      call prop_type_add(l:group, { "bufnr": a:bufnr, "highlight": l:group })
    endfor
  endif
endfunction

function! coc#semantic_highlight#add_highlights(bufnr, highlights) abort
  let l:nsid = s:is_vim ? -1 : nvim_create_namespace(s:namespace)
  for [l:line, l:hls] in items(a:highlights)
    call s:remove_highlight(l:nsid, a:bufnr, str2nr(l:line))
    for l:hl in l:hls
      call s:add_highlight(l:nsid, a:bufnr, l:hl)
    endfor
  endfor
endfunction

function! s:remove_highlight(nsid, bufnr, line) abort
  if s:is_vim
    call prop_clear(a:line + 1, a:line + 1, {"bufnr": a:bufnr})
  else
    call nvim_buf_clear_namespace(a:bufnr, a:nsid, a:line, a:line + 1)
  endif
endfunction

function! s:add_highlight(nsid, bufnr, hl) abort
  if s:is_vim
    let l:type = a:hl["group"]
    let l:line = a:hl["line"] + 1
    let l:start = a:hl["startCharacter"] + 1
    let l:end = a:hl["endCharacter"] + 1
    call prop_add(l:line, l:start, {
          \   "end_lnum": l:line,
          \   "end_col": l:end,
          \   "bufnr": a:bufnr,
          \   "type": l:type
          \ })
  else
    let l:group = a:hl["group"]
    let l:line = a:hl["line"]
    let l:start = a:hl["startCharacter"]
    let l:end = a:hl["endCharacter"]
    call nvim_buf_add_highlight(
          \   a:bufnr,
          \   a:nsid,
          \   l:group,
          \   l:line,
          \   l:start,
          \   l:end
          \ )
  endif
endfunction


function! coc#semantic_highlight#clear_highlights(bufnr) abort
  if s:is_vim
    let l:lines = len(getbufline(a:bufnr, 1, '$'))
    call prop_clear(1, l:lines, {"bufnr": a:bufnr})
  else
    let l:nsid = nvim_create_namespace(s:namespace)
    call nvim_buf_clear_namespace(a:bufnr, l:nsid, 0, -1)
  endif
endfunction

function! coc#semantic_highlight#get_highlights(bufnr) abort
  let l:res = []

  if s:is_vim
    let l:lines = len(getbufline(a:bufnr, 1, '$'))
    for l:line in range(l:lines)
      let l:list = prop_list(l:line + 1, {"bufnr": a:bufnr})
      for l:prop in l:list
        if l:prop["start"] == 0 || l:prop["end"] == 0
          " multi line tokens are not supported; simply ignore it
          continue
        endif

        let l:group = l:prop["type"]
        let l:start = l:prop["col"] - 1
        let l:end = l:start + l:prop["length"]
        call add(l:res, {
              \   "group": l:group,
              \   "line": l:line,
              \   "startCharacter": l:start,
              \   "endCharacter": l:end
              \ })
      endfor
    endfor
  else
    let l:nsid = nvim_create_namespace(s:namespace)
    let l:marks = nvim_buf_get_extmarks(a:bufnr, l:nsid, 0, -1, {"details": v:true})
    for [_, l:line, l:start, l:details] in l:marks
      call add(l:res, {
            \   "group": l:details["hl_group"],
            \   "line": l:line,
            \   "startCharacter": l:start,
            \   "endCharacter": l:details["end_col"]
            \ })
    endfor
  endif

  return l:res
endfunction
