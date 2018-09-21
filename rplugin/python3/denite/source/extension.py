# ============================================================================
# FILE: command.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
from denite.kind.base import Base as BaseKind
from denite.source.base import Base


class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'coc-extension'
        self.matchers = ['matcher_fuzzy']
        self.sorters = ['sorter/sublime']
        self.kind = Kind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_ExtensionHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_ExtensionRoot /\v\s*\f+$/ contained '
                         r'containedin=deniteSource_ExtensionHeader')
        self.vim.command(r'syntax match deniteSource_ExtensionActivited /\v^\s+\*/ contained '
                         r'containedin=deniteSource_ExtensionHeader')
        self.vim.command(r'syntax match deniteSource_ExtensionLoaded /\v^\s+\+\s/ contained '
                         r'containedin=deniteSource_ExtensionHeader')
        self.vim.command(r'syntax match deniteSource_ExtensionDisabled /\v^\s+-\s/ contained '
                         r'containedin=deniteSource_ExtensionHeader')
        self.vim.command(r'syntax match deniteSource_ExtensionName /\v%5c\S+/ contained '
                         r'containedin=deniteSource_ExtensionHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteSource_ExtensionRoot Comment')
        self.vim.command('highlight default link deniteSource_ExtensionDisabled Comment')
        self.vim.command('highlight default link deniteSource_ExtensionActivited MoreMsg')
        self.vim.command('highlight default link deniteSource_ExtensionLoaded Normal')
        self.vim.command('highlight default link deniteSource_ExtensionName String')

    def gather_candidates(self, context):
        items = self.vim.call('CocAction', 'extensionStats')
        if items is None or items is 0:
            return []
        candidates = []
        for item in items:
            state = '+'
            if item['state'] == 'activited':
                state = '*'
            elif item['state'] == 'disabled':
                state = '-'
            root = self.vim.call('resolve', item['root'])
            candidates.append({
                'word': item['id'],
                'abbr': ' %s %s %s' % (state, item['id'], root),
                'source__id': item['id']
                })

        return candidates


class Kind(BaseKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'toggle'
        self.redraw_actions += ['toggle', 'uninstall']
        self.persist_actions += ['toggle', 'uninstall']

    def action_toggle(self, context):
        for target in context['targets']:
            self.vim.call('CocAction', 'toggleExtension', target['source__id'])

    def action_activate(self, context):
        for target in context['targets']:
            self.vim.call('CocAction', 'activeExtension', target['source__id'])

    def action_reload(self, context):
        for target in context['targets']:
            self.vim.call('CocAction', 'reloadExtension', target['source__id'])

    def action_deactivate(self, context):
        for target in context['targets']:
            self.vim.call('CocAction', 'deactivateExtension', target['source__id'])

    def action_uninstall(self, context):
        for target in context['targets']:
            self.vim.call('CocAction', 'uninstallExtension', target['source__id'])
