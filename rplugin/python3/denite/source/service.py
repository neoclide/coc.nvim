# ============================================================================
# FILE: service.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
from denite.kind.base import Base as BaseKind
from denite.source.base import Base

class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'coc-service'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []
        self.kind = SourceKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteService_CocHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteService_CocStar /\v^\%1c.*\%3c/ contained '
                         r'containedin=deniteService_CocHeader')
        self.vim.command(r'syntax match deniteService_CocName /\%4c.*\%22c/ contained '
                         r'containedin=deniteService_CocHeader')
        self.vim.command(r'syntax match deniteService_CocState /\%25c.*\%35c/ contained '
                         r'containedin=deniteService_CocHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteService_CocStar Special')
        self.vim.command('highlight default link deniteService_CocName Type')
        self.vim.command('highlight default link deniteService_CocState Statement')

    def gather_candidates(self, context):
        items = self.vim.call('CocAction', 'services')
        candidates = []
        for item in items:
            name = item['name']
            prefix = '   ' if item['state'] != 'running' else ' * '
            t = '[%s]' % (item['state'])
            candidates.append({
                'word': name,
                'abbr': '%s %-18s %-10s' % (prefix, name, t),
                'source__name': name
                })

        return candidates


class SourceKind(BaseKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'restart'
        self.redraw_actions += ['restart']
        self.persist_actions += ['restart']

    def action_restart(self, context):
        target = context['targets'][0]
        self.vim.call('CocAction', 'restartService', target['source__name'])
