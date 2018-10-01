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
        self.sorters = []
        self.kind = SourceKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteService_CocHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteService_CocStar /\v^\%1c.*\%3c/ contained '
                         r'containedin=deniteService_CocHeader')
        self.vim.command(r'syntax match deniteService_CocName /\v%4c[^[]*(\[)@=/ contained '
                         r'containedin=deniteService_CocHeader')
        self.vim.command(r'syntax match deniteService_CocState /\v\[[^[\]]*\]/ contained '
                         r'containedin=deniteService_CocHeader')
        self.vim.command(r'syntax match deniteService_CocLanguages /\v(\])@<=.*$/ contained '
                         r'containedin=deniteService_CocHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteService_CocStar Special')
        self.vim.command('highlight default link deniteService_CocName Type')
        self.vim.command('highlight default link deniteService_CocState Statement')
        self.vim.command('highlight default link deniteService_CocLanguages Comment')

    def gather_candidates(self, context):
        items = self.vim.call('CocAction', 'services')
        if items is None or items is 0:
            return []
        candidates = []
        for item in items:
            name = item['id']
            prefix = '   ' if item['state'] != 'running' else ' * '
            t = '[%s]' % (item['state'])
            languageIds = ', '.join(item['languageIds'])
            candidates.append({
                'word': name,
                'abbr': '%s %-18s %-10s %s' % (prefix, name, t, languageIds),
                'source__name': name
                })

        return candidates


class SourceKind(BaseKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'toggle'
        self.redraw_actions += ['toggle']
        self.persist_actions += ['toggle']

    def action_toggle(self, context):
        target = context['targets'][0]
        self.vim.call('CocAction', 'toggleService', target['source__name'])
