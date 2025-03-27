__requesting = True
def coc_UltiSnips_create():
    import re, vim, os, sys
    from collections import defaultdict, namedtuple

    _Placeholder = namedtuple("_Placeholder", ["current_text", "start", "end"])
    _VisualContent = namedtuple("_VisualContent", ["mode", "text"])
    _Position = namedtuple("_Position", ["line", "col"])
    # is_vim = vim.eval('has("nvim")') == '0'

    def byte2col(line, nbyte):
        """Convert a column into a byteidx suitable for a mark or cursor
        position inside of vim."""
        line = vim.current.buffer[line - 1]
        raw_bytes = line.encode(vim.eval("&encoding"), "replace")[:nbyte]
        return len(raw_bytes.decode(vim.eval("&encoding"), "replace"))

    def col2byte(line, col):
        """Convert a valid column index into a byte index inside of vims
        buffer."""
        # We pad the line so that selecting the +1 st column still works.
        pre_chars = (vim.current.buffer[line - 1] + "  ")[:col]
        return len(pre_chars.encode(vim.eval("&encoding"), "replace"))

    def get_visual_content():
        mode = vim.eval("visualmode()")
        if mode == '':
          return ''
        sl, sbyte = map(
            int, (vim.eval("""line("'<")"""), vim.eval("""col("'<")"""))
        )
        el, ebyte = map(
            int, (vim.eval("""line("'>")"""), vim.eval("""col("'>")"""))
        )
        sc = byte2col(sl, sbyte - 1)
        ec = byte2col(el, ebyte - 1)
        # When 'selection' is 'exclusive', the > mark is one column behind the
        # actual content being copied, but never before the < mark.
        if vim.eval("&selection") == "exclusive":
            if not (sl == el and sbyte == ebyte):
                ec -= 1

        _vim_line_with_eol = lambda ln: vim.current.buffer[ln] + "\n"

        if sl == el:
            text = _vim_line_with_eol(sl - 1)[sc : ec + 1]
        else:
            text = _vim_line_with_eol(sl - 1)[sc:]
            for cl in range(sl, el - 1):
                text += _vim_line_with_eol(cl)
            text += _vim_line_with_eol(el - 1)[: ec + 1]
        return text

    def _expand_anon(value, trigger=""):
        pos = vim.eval('coc#cursor#position()')
        line = int(pos[0])
        character = int(pos[1])
        args = r'[{"start":{"line":%d,"character":%d},"end":{"line":%d,"character":%d}}, "%s", v:null, {}]' % (line, character - len(trigger), line, character, re.sub(r'"', r'\\"', value.replace('\\', '\\\\')))
        # Python of vim doesn't have event loop, use vim's timer
        if __requesting:
            vim.eval(r'coc#util#timer("coc#rpc#notify",["snippetInsert", %s])' % (args))
        else:
            code = r'coc#rpc#request("snippetInsert", %s)' % (args)
            vim.eval(code)
            vim.command('redraw')

    def expand_anon(value, trigger="", cursor = None):
        if len(value) == 0:
            return
        _expand_anon(value, trigger)
        if cursor is not None:
            cursor.preserve()

    class Position:
        """Represents a Position in a text file: (0 based line index, 0 based column
        index) and provides methods for moving them around."""

        def __init__(self, line, col):
            self.line = line
            self.col = col

        def move(self, pivot, delta):
            """'pivot' is the position of the first changed character, 'delta' is
            how text after it moved."""
            if self < pivot:
                return
            if delta.line == 0:
                if self.line == pivot.line:
                    self.col += delta.col
            elif delta.line > 0:
                if self.line == pivot.line:
                    self.col += delta.col - pivot.col
                self.line += delta.line
            else:
                self.line += delta.line
                if self.line == pivot.line:
                    self.col += -delta.col + pivot.col

        def __add__(self, pos):
            assert isinstance(pos, Position)
            return Position(self.line + pos.line, self.col + pos.col)

        def __sub__(self, pos):
            assert isinstance(pos, Position)
            return Position(self.line - pos.line, self.col - pos.col)

        def __eq__(self, other):
            return (self.line, self.col) == (other.line, other.col)

        def __ne__(self, other):
            return (self.line, self.col) != (other.line, other.col)

        def __lt__(self, other):
            return (self.line, self.col) < (other.line, other.col)

        def __le__(self, other):
            return (self.line, self.col) <= (other.line, other.col)

        def __repr__(self):
            return "(%i,%i)" % (self.line, self.col)

        def __getitem__(self, index):
            if index > 1:
                raise IndexError("position can be indexed only 0 (line) and 1 (column)")
            if index == 0:
                return self.line
            else:
                return self.col

    def diff(a, b, sline=0):
        """
        Return a list of deletions and insertions that will turn 'a' into 'b'. This
        is done by traversing an implicit edit graph and searching for the shortest
        route. The basic idea is as follows:

            - Matching a character is free as long as there was no
              deletion/insertion before. Then, matching will be seen as delete +
              insert [1].
            - Deleting one character has the same cost everywhere. Each additional
              character costs only have of the first deletion.
            - Insertion is cheaper the earlier it happens. The first character is
              more expensive that any later [2].

        [1] This is that world -> aolsa will be "D" world + "I" aolsa instead of
            "D" w , "D" rld, "I" a, "I" lsa
        [2] This is that "hello\n\n" -> "hello\n\n\n" will insert a newline after
            hello and not after \n
        """
        d = defaultdict(list)  # pylint:disable=invalid-name
        seen = defaultdict(lambda: sys.maxsize)

        d[0] = [(0, 0, sline, 0, ())]
        cost = 0
        deletion_cost = len(a) + len(b)
        insertion_cost = len(a) + len(b)
        while True:
            while len(d[cost]):
                x, y, line, col, what = d[cost].pop()

                if a[x:] == b[y:]:
                    return what

                if x < len(a) and y < len(b) and a[x] == b[y]:
                    ncol = col + 1
                    nline = line
                    if a[x] == "\n":
                        ncol = 0
                        nline += 1
                    lcost = cost + 1
                    if (
                        what
                        and what[-1][0] == "D"
                        and what[-1][1] == line
                        and what[-1][2] == col
                        and a[x] != "\n"
                    ):
                        # Matching directly after a deletion should be as costly as
                        # DELETE + INSERT + a bit
                        lcost = (deletion_cost + insertion_cost) * 1.5
                    if seen[x + 1, y + 1] > lcost:
                        d[lcost].append((x + 1, y + 1, nline, ncol, what))
                        seen[x + 1, y + 1] = lcost
                if y < len(b):  # INSERT
                    ncol = col + 1
                    nline = line
                    if b[y] == "\n":
                        ncol = 0
                        nline += 1
                    if (
                        what
                        and what[-1][0] == "I"
                        and what[-1][1] == nline
                        and what[-1][2] + len(what[-1][-1]) == col
                        and b[y] != "\n"
                        and seen[x, y + 1] > cost + (insertion_cost + ncol) // 2
                    ):
                        seen[x, y + 1] = cost + (insertion_cost + ncol) // 2
                        d[cost + (insertion_cost + ncol) // 2].append(
                            (
                                x,
                                y + 1,
                                line,
                                ncol,
                                what[:-1]
                                + (("I", what[-1][1], what[-1][2], what[-1][-1] + b[y]),),
                            )
                        )
                    elif seen[x, y + 1] > cost + insertion_cost + ncol:
                        seen[x, y + 1] = cost + insertion_cost + ncol
                        d[cost + ncol + insertion_cost].append(
                            (x, y + 1, nline, ncol, what + (("I", line, col, b[y]),))
                        )
                if x < len(a):  # DELETE
                    if (
                        what
                        and what[-1][0] == "D"
                        and what[-1][1] == line
                        and what[-1][2] == col
                        and a[x] != "\n"
                        and what[-1][-1] != "\n"
                        and seen[x + 1, y] > cost + deletion_cost // 2
                    ):
                        seen[x + 1, y] = cost + deletion_cost // 2
                        d[cost + deletion_cost // 2].append(
                            (
                                x + 1,
                                y,
                                line,
                                col,
                                what[:-1] + (("D", line, col, what[-1][-1] + a[x]),),
                            )
                        )
                    elif seen[x + 1, y] > cost + deletion_cost:
                        seen[x + 1, y] = cost + deletion_cost
                        d[cost + deletion_cost].append(
                            (x + 1, y, line, col, what + (("D", line, col, a[x]),))
                        )
            cost += 1

    class VimBuffer:

        """Wrapper around the current Vim buffer."""

        def __getitem__(self, idx):
            return vim.current.buffer[idx]

        def __setitem__(self, idx, text):
            vim.current.buffer[idx] = text

        def __len__(self):
            return len(vim.current.buffer)

        @property
        def number(self):  # pylint:disable=no-self-use
            """The bufnr() of the current buffer."""
            return vim.current.buffer.number

        @property
        def filetypes(self):
            return [ft for ft in vim.eval("&filetype").split(".") if ft]

    class VimBufferProxy(VimBuffer):
        """
        Proxy object used for tracking changes that made from snippet actions.

        Unfortunately, vim by itself lacks of the API for changing text in
        trackable maner.

        Vim marks offers limited functionality for tracking line additions and
        deletions, but nothing offered for tracking changes withing single line.

        Instance of this class is passed to all snippet actions and behaves as
        internal vim.current.window.buffer.

        All changes that are made by user passed to diff algorithm, and resulting
        diff applied to internal snippet structures to ensure they are in sync with
        actual buffer contents.
        """
        def __init__(self, handlers):
            """
            Instantiate new object.
            """
            self._buffer = vim.current.buffer
            self._change_tick = int(vim.eval("b:changedtick"))
            self._forward_edits = True
            self._handlers = handlers

        def is_buffer_changed_outside(self):
            """
            Returns true, if buffer was changed without using proxy object, like
            with vim.command() or through internal vim.current.window.buffer.
            """
            return self._change_tick < int(vim.eval("b:changedtick"))

        def validate_buffer(self):
            """
            Raises exception if buffer is changes beyound proxy object.
            """
            if self.is_buffer_changed_outside():
                raise os.error(
                    "buffer was modified using vim.command or "
                    + "vim.current.buffer; that changes are untrackable and leads to "
                    + "errors in snippet expansion; use special variable `snip.buffer` "
                    "for buffer modifications.\n\n"
                    + "See :help UltiSnips-buffer-proxy for more info."
                )

        def __setitem__(self, key, value):
            """
            Behaves as vim.current.window.buffer.__setitem__ except it tracks
            changes and applies them to the current snippet stack.
            """
            if isinstance(key, slice):
                value = [line for line in value]
                changes = list(self._get_diff(key.start, key.stop, value))
                self._buffer[key.start : key.stop] = [line.strip("\n") for line in value]
            else:
                value = value
                changes = list(self._get_line_diff(key, self._buffer[key], value))
                self._buffer[key] = value

            self._change_tick += 1

            if self._forward_edits:
                for change in changes:
                    self._apply_change(change)

        def __setslice__(self, i, j, text):
            """
            Same as __setitem__.
            """
            self.__setitem__(slice(i, j), text)

        def __getitem__(self, key):
            """
            Just passing call to the vim.current.window.buffer.__getitem__.
            """
            return self._buffer[key]

        def __getslice__(self, i, j):
            """
            Same as __getitem__.
            """
            return self.__getitem__(slice(i, j))

        def __len__(self):
            """
            Same as len(vim.current.window.buffer).
            """
            return len(self._buffer)

        def append(self, line, line_number=-1):
            """
            Same as vim.current.window.buffer.append(), but with tracking changes.
            """
            if line_number < 0:
                line_number = len(self)
            if not isinstance(line, list):
                line = [line]
            self[line_number:line_number] = [l for l in line]

        def insert(self, index, line):
            self[index:index] = [line]

        def __delitem__(self, key):
            if isinstance(key, slice):
                self.__setitem__(key, [])
            else:
                self.__setitem__(slice(key, key + 1), [])

        def _get_diff(self, start, end, new_value):
            """
            Very fast diffing algorithm when changes are across many lines.
            """
            for line_number in range(start, end):
                if line_number < 0:
                    line_number = len(self._buffer) + line_number
                yield ("D", line_number, 0, self._buffer[line_number], True)

            if start < 0:
                start = len(self._buffer) + start
            for line_number in range(0, len(new_value)):
                yield ("I", start + line_number, 0, new_value[line_number], True)

        def _get_line_diff(self, line_number, before, after):
            """
            Use precise diffing for tracking changes in single line.
            """
            if before == "":
                for change in self._get_diff(line_number, line_number + 1, [after]):
                    yield change
            else:
                for change in diff(before, after):
                    yield (change[0], line_number, change[2], change[3])

        def _apply_change(self, change):
            """
            Apply changeset to current snippets stack, correctly moving around
            snippet itself or its child.
            """
            # ('I', 4, 0, 'xy')
            # change_type, line_number, column_number, change_text = change[0:4]
            if len(self._handlers) > 0:
              for handler in self._handlers:
                handler._apply_change(change)
            else:
              print(str(change))
              pass

        def _disable_edits(self):
            """
            Temporary disable applying changes to snippets stack. Should be done
            while expanding anonymous snippet in the middle of jump to prevent
            double tracking.
            """
            self._forward_edits = False

        def _enable_edits(self):
            """
            Enables changes forwarding back.
            """
            self._forward_edits = True

    class PositionWrapper(object):

        def __init__(self, position):
            self._position = position
            self._valid = True

        def _apply_change(self, change):
            # ('I', 4, 0, 'xy', True)
            pos = self._position
            start = Position(change[1], change[2])
            col = change[2]
            insert = change[0] == 'I'
            newline = len(change) > 4
            if newline:
                if not insert and change[1] == pos.line:
                    self._valid = False
                    return
            else:
                if change[1] == pos.line:
                  if not insert and change[2] + len(change[3]) > pos.col:
                      self._valid = False
                      return
                  col = len(change[3]) if insert else 0 - len(change[3])
            lc = 0
            if newline:
                lc = 1 if insert else -1
            pos.move(start, _Position(lc, col))

        @property
        def valid(self):
            return self._valid

        @property
        def position(self):
            return self._position

    class SnippetUtilCursor(object):
        def __init__(self, cursor):
            self._cursor = [cursor[0] - 1, cursor[1]]
            self._set = False

        def preserve(self):
            self._set = True
            cursor = vim.current.window.cursor
            self._cursor = [cursor[0] - 1, cursor[1]]

        def is_set(self):
            return self._set

        def set(self, line, column):
            self.__setitem__(0, line)
            self.__setitem__(1, column)
            # vim.current.window.cursor = self.to_vim_cursor()

        def to_vim_cursor(self):
            return (self._cursor[0] + 1, self._cursor[1])

        def __getitem__(self, index):
            return self._cursor[index]

        def __setitem__(self, index, value):
            self._set = True
            self._cursor[index] = value

        def __len__(self):
            return 2

        def __str__(self):
            return str((self._cursor[0], self._cursor[1]))

    class IndentUtil(object):

        """Utility class for dealing properly with indentation."""

        def __init__(self):
            self.reset()

        def reset(self):
            """Gets the spacing properties from Vim."""
            self.shiftwidth = int(
                vim.eval("exists('*shiftwidth') ? shiftwidth() : &shiftwidth")
            )
            self._expandtab = vim.eval("&expandtab") == "1"
            self._tabstop = int(vim.eval("&tabstop"))

        def ntabs_to_proper_indent(self, ntabs):
            """Convert 'ntabs' number of tabs to the proper indent prefix."""
            line_ind = ntabs * self.shiftwidth * " "
            line_ind = self.indent_to_spaces(line_ind)
            line_ind = self.spaces_to_indent(line_ind)
            return line_ind

        def indent_to_spaces(self, indent):
            """Converts indentation to spaces respecting Vim settings."""
            indent = indent.expandtabs(self._tabstop)
            right = (len(indent) - len(indent.rstrip(" "))) * " "
            indent = indent.replace(" ", "")
            indent = indent.replace("\t", " " * self._tabstop)
            return indent + right

        def spaces_to_indent(self, indent):
            """Converts spaces to proper indentation respecting Vim settings."""
            if not self._expandtab:
                indent = indent.replace(" " * self._tabstop, "\t")
            return indent

    class BaseContext(object):
        def __init__(self):
            super().__init__()
            self._cursor = SnippetUtilCursor(vim.current.window.cursor)
            line = self._cursor[0]
            pos = Position(line, byte2col(line + 1, self._cursor[1]))
            wrapper = PositionWrapper(pos)
            self._handlers = [wrapper]
            self._buffer = VimBufferProxy(self._handlers)

        @property
        def window(self):
            return vim.current.window

        @property
        def buffer(self):
            return self._buffer

        @property
        def cursor(self):
            return self._cursor

        @property
        def line(self):
            return vim.current.window.cursor[0] - 1

        @property
        def column(self):
            return vim.current.window.cursor[1]

        @property
        def visual_mode(self):
            return vim.eval("visualmode()")

        @property
        def visual_text(self):
            if "coc_selected_text" in vim.vars:
                return vim.vars["coc_selected_text"]
            return ''

        @property
        def last_placeholder(self):
            if "coc_last_placeholder" in vim.vars:
                p = vim.vars["coc_last_placeholder"]
                start = _Position(p["start"]["line"], p["start"]["col"])
                end = _Position(p["end"]["line"], p["end"]["col"])
                return _Placeholder(p["current_text"], start, end)
            return None

        def expand_anon(self, value, trigger="", description="", options="", context=None, actions=None):
            expand_anon(value, trigger, self._cursor)
            return True

    class SnippetUtil(object):

        def __init__(self, _initial_indent, start, end, context):
            self._ind = IndentUtil()
            self._visual = _VisualContent(
                vim.eval("visualmode()"), vim.eval('get(g:,"coc_selected_text","")')
            )
            self._initial_indent = _initial_indent
            self._reset("")
            self._start = Position(start[0], start[1])
            self._end = Position(end[0], end[1])
            self._context = context

        def _reset(self, cur):
            """Gets the snippet ready for another update.

            :cur: the new value for c.

            """
            self._ind.reset()
            self._cur = cur
            self._rv = ""
            self._changed = False
            self.reset_indent()

        def shift(self, amount=1):
            """Shifts the indentation level. Note that this uses the shiftwidth
            because thats what code formatters use.

            :amount: the amount by which to shift.

            """
            self.indent += " " * self._ind.shiftwidth * amount

        def unshift(self, amount=1):
            """Unshift the indentation level. Note that this uses the shiftwidth
            because thats what code formatters use.

            :amount: the amount by which to unshift.

            """
            by = -self._ind.shiftwidth * amount
            try:
                self.indent = self.indent[:by]
            except IndexError:
                self.indent = ""

        def mkline(self, line="", indent=None):
            """Creates a properly set up line.

            :line: the text to add
            :indent: the indentation to have at the beginning
                    if None, it uses the default amount

            """
            if indent is None:
                indent = self.indent
                # this deals with the fact that the first line is
                # already properly indented
                if "\n" not in self._rv:
                    try:
                        indent = indent[len(self._initial_indent) :]
                    except IndexError:
                        indent = ""
                indent = self._ind.spaces_to_indent(indent)

            return indent + line

        def reset_indent(self):
            """Clears the indentation."""
            self.indent = self._initial_indent

        def expand_anon(self, value, trigger="", description="", options="", context=None, actions=None):
            expand_anon(value, trigger)
            return True


        # Utility methods
        @property
        def fn(self):  # pylint:disable=no-self-use,invalid-name
            """The filename."""
            return vim.eval('expand("%:t")') or ""

        @property
        def basename(self):  # pylint:disable=no-self-use
            """The filename without extension."""
            return vim.eval('expand("%:t:r")') or ""

        @property
        def ft(self):  # pylint:disable=invalid-name
            """The filetype."""
            return self.opt("&filetype", "")

        @property
        def rv(self):  # pylint:disable=invalid-name
            """The return value.

            The text to insert at the location of the placeholder.

            """
            return self._rv

        @rv.setter
        def rv(self, value):  # pylint:disable=invalid-name
            """See getter."""
            self._changed = True
            self._rv = value

        @property
        def _rv_changed(self):
            """True if rv has changed."""
            return self._changed

        @property
        def c(self):  # pylint:disable=invalid-name
            """The current text of the placeholder."""
            return self._cur

        @property
        def v(self):  # pylint:disable=invalid-name
            """Content of visual expansions."""
            return self._visual

        @property
        def p(self):
            if "coc_last_placeholder" in vim.vars:
                p = vim.vars["coc_last_placeholder"]
                start = _Position(p["start"]["line"], p["start"]["col"])
                end = _Position(p["end"]["line"], p["end"]["col"])
                return _Placeholder(p["current_text"], start, end)
            return None

        @property
        def context(self):
            return self._context

        def opt(self, option, default=None):  # pylint:disable=no-self-use
            """Gets a Vim variable."""
            if vim.eval("exists('%s')" % option) == "1":
                try:
                    return vim.eval(option)
                except vim.error:
                    pass
            return default

        def __add__(self, value):
            """Appends the given line to rv using mkline."""
            self.rv += "\n"  # pylint:disable=invalid-name
            self.rv += self.mkline(value)
            return self

        def __lshift__(self, other):
            """Same as unshift."""
            self.unshift(other)

        def __rshift__(self, other):
            """Same as shift."""
            self.shift(other)

        @property
        def snippet_start(self):
            """
            Returns start of the snippet in format (line, column).
            """
            return self._start

        @property
        def snippet_end(self):
            """
            Returns end of the snippet in format (line, column).
            """
            return self._end

        @property
        def buffer(self):
            return vim.current.buffer

    class ContextSnippet(BaseContext):
        def __init__(self):
            super().__init__()
            self._before = vim.eval('strpart(getline("."), 0, col(".") - 1)')
            self._after = vim.eval('strpart(getline("."), col(".") - 1)')

        @property
        def before(self):
            return self._before

        @property
        def after(self):
            return self._after

    class PreExpandContext(BaseContext):
        @property
        def visual_content(self):  # pylint:disable=no-self-use
            return get_visual_content()

        def getResult(self):
            wrapper = self._handlers[0]
            valid = wrapper.valid and not self._cursor.is_set()
            if (self._cursor.is_set()):
                vimcursor = self._cursor.to_vim_cursor()
            else:
                if wrapper.valid:
                    position = wrapper.position
                    line = position.line + 1
                    vimcursor = (line, col2byte(line, position.col))
                else:
                    vimcursor = vim.current.window.cursor
            # vim.current.window.cursor = vimcursor
            # 0 based, line - character
            cursor = [vimcursor[0] - 1, byte2col(vimcursor[0], vimcursor[1])]
            return [valid, cursor]

    class PostExpandContext(BaseContext):
        def __init__(self, positions):
            super().__init__()
            self._start = PositionWrapper(Position(positions[0], positions[1]))
            self._end = PositionWrapper(Position(positions[2], positions[3]))
            self._handlers.extend([self._start, self._end])

        @property
        def snippet_start(self):
            return self._start.position

        @property
        def snippet_end(self):
            return self._end.position

    class PostJumpContext(PostExpandContext):
        def __init__(self, positions, tabstop, forward):
            super().__init__(positions)
            self.tabstop = tabstop
            self.jump_direction = 1 if forward else -1

        @property
        def tabstops(self):
            vimtabstops = vim.vars["coc_ultisnips_tabstops"]
            if vimtabstops is None:
                return {}
            tabstops = {}
            for stop in vimtabstops:
                index = stop['index']
                indexes = stop['range']
                start = _Position(indexes[0], indexes[1])
                end =  _Position(indexes[2], indexes[3])
                tabstops[index] = _Placeholder(stop['text'], start, end)
            return tabstops

    namespace = {
        'SnippetUtil': SnippetUtil,
        'ContextSnippet': ContextSnippet,
        'PreExpandContext': PreExpandContext,
        'PostExpandContext': PostExpandContext,
        'PostJumpContext': PostJumpContext,
    }
    return namespace

coc_ultisnips_dict = coc_UltiSnips_create()
SnippetUtil = coc_ultisnips_dict['SnippetUtil']
ContextSnippet = coc_ultisnips_dict['ContextSnippet']

# vim:set et sw=4 ts=4:
