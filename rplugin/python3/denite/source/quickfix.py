# ============================================================================
# FILE: quickfix.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
import re
from denite.kind.file import Kind as FileKind
from denite.source.base import Base
from os.path import relpath

class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'quickfix'
        self.kind = 'file'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []

        self.kind = QuickfixKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_QuickfixHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_QuickfixName /\v^[^|]+/ contained '
                r'containedin=deniteSource_QuickfixHeader')
        self.vim.command(r'syntax match deniteSource_QuickfixPosition /\v\|\zs.{-}\ze\|/ contained '
                r'containedin=deniteSource_QuickfixHeader')
        self.vim.command(r'syntax match deniteSource_QuickfixError /Error/ contained '
                r'containedin=deniteSource_QuickfixPosition')
        self.vim.command(r'syntax match deniteSource_QuickfixWarning /Warning/ contained '
                r'containedin=deniteSource_QuickfixPosition')
        word = self.vim.eval('get(g:,"grep_word", "")')
        if word:
            pattern = re.escape(word)
            self.vim.command(r'syntax match deniteSource_QuickfixWord /%s/' % pattern)

    def highlight(self):
        self.vim.command('highlight default link deniteSource_QuickfixWord Search')
        self.vim.command('highlight default link deniteSource_QuickfixName Directory')
        self.vim.command('highlight default link deniteSource_QuickfixPosition LineNr')
        self.vim.command('highlight default link deniteSource_QuickfixError Error')
        self.vim.command('highlight default link deniteSource_QuickfixWarning WarningMsg')

    def on_init(self, context):
        context['__root'] = self.vim.call('getcwd')

    def convert(self, val, index, context):
        root = context['__root']
        bufnr = val['bufnr']
        line = int(val['lnum']) if bufnr != 0 else 0
        col = int(val['col']) if bufnr != 0 else 0
        location = '' if line == 0 and col == 0 else '%d col %d' % (line, col)
        if val['type']:
            location = location + ' ' + get_type(val['type'])

        fname = "" if bufnr == 0 else self.vim.eval('bufname(' + str(bufnr) + ')')
        word = '{fname} |{location}| {text}'.format(
            fname=relpath(fname, root),
            location=location,
            text=val['text'].replace('\n', ' '))

        return {
            'word': word,
            'action__text': val['text'],
            'action__path': fname,
            'action__line': line,
            'action__col': col,
            'action__buffer_nr': bufnr,
            'action__index': index,
            }

    def gather_candidates(self, context):
        items = self.vim.eval('getqflist()')
        res = []

        for idx, item in enumerate(items):
            if item['valid'] != 0:
                res.append(self.convert(item, idx + 1, context))
        return res


def get_type(t):
    if t == 'E':
        return 'Error'
    if t == 'W':
        return 'Warning'
    return t


class QuickfixKind(FileKind):
    """ Support the 'cc' quickfix action, storing where you are in the quickfix
    list, so that you can take advantage of :cnext/:cprev features.
    """

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'cc'

    def action_quickfix(self, context):
        """ Use the default file 'kind', but override quickfix, so that it uses
        'Denite quickfix' rather than 'copen'
        """

        qflist = [{
            'filename': x['action__path'],
            'col': x['action__col'],
            'lnum': x['action__line'],
            'text': x['action__text'],
        } for x in context['targets']
                  if 'action__line' in x and 'action__text' in x]
        self.vim.call('setqflist', qflist)
        context['sources_queue'].append([
            {'name': 'quickfix', 'args': []}
        ])
        context['auto_resize'] = True
        context['mode'] = 'normal'

    def action_cc(self, context):
        target = context['targets'][0]
        index = target['action__index']
        self.vim.call('coc#util#cc', index)
