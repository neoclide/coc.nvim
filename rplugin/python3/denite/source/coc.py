# ============================================================================
# FILE: coc.py
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

        self.name = 'coc'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []
        self.kind = CocKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_CocHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_CocStar /\v^\%1c.*\%3c/ contained '
                         r'containedin=deniteSource_CocHeader')
        self.vim.command(r'syntax match deniteSource_CocName /\%4c.*\%22c/ contained '
                         r'containedin=deniteSource_CocHeader')
        self.vim.command(r'syntax match deniteSource_CocType /\%25c.*\%35c/ contained '
                         r'containedin=deniteSource_CocHeader')
        self.vim.command(r'syntax match deniteSource_CocPath /\%36c.*$/ contained '
                         r'containedin=deniteSource_CocHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteSource_CocStar Special')
        self.vim.command('highlight default link deniteSource_CocName Type')
        self.vim.command('highlight default link deniteSource_CocType Statement')
        self.vim.command('highlight default link deniteSource_CocPath Comment')

    def gather_candidates(self, context):
        items = self.vim.eval('CocSourceStat()')
        candidates = []
        for item in items:
            name = item['name']
            prefix = '   ' if item['disabled'] else ' * '
            t = '[%s]' % (item['type'])
            filepath = item['filepath']
            candidates.append({
                'word': name,
                'abbr': '%s %-18s %-10s %s' % (prefix, name, t, filepath),
                'action__path': filepath,
                'source__name': name
                })

        return candidates


class CocKind(FileKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'toggle'
        self.redraw_actions += ['toggle']
        self.persist_actions += ['toggle']

    def action_toggle(self, context):
        target = context['targets'][0]
        self.vim.call('CocSourceToggle', target['source__name'])

    def action_refresh(self, context):
        target = context['targets'][0]
        self.vim.call('CocSourceRefresh', target['source__name'])
