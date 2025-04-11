
function legacy#dict_add() dict
  return self.key + 1
endfunction

function legacy#win_execute() abort
  call win_execute(win_getid(), ['let w:foo = "a"."b"'])
endfunction
