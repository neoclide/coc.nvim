# AGENTS.md

## Project Overview

coc.nvim is a language client framework for Vim and Neovim.
It provides LSP integration, extension APIs, completion, diagnostics,
workspace management and plugin infrastructure.

This project is performance-sensitive and must maintain compatibility
with existing Vim/Neovim users.

---

## Compatibility Requirements

Maintain compatibility with:

- Vim 9+ and neovim
- Existing coc.nvim extensions
- Existing user configurations

Avoid:

- breaking public APIs
- changing extension behavior unintentionally
- changing configuration semantics

---

## TypeScript Rules

- Use strict TypeScript.
- Avoid `any` unless unavoidable.
- Prefer existing utility functions over introducing new helpers.

---

## Async and Resource Management

Be careful with:

- promises
- event listeners
- timers
- child processes
- RPC channels
- Vim/Neovim lifecycle

Every created resource should have a clear cleanup path.

Check:

- error handling
- cancellation
- process shutdown
- disposal behavior

---

## Git Rules

Before editing:

- inspect git history when behavior is unclear
- understand why existing code exists

Do not remove existing code only because it looks unused.

---

## Forbidden Actions

Do not:

- change public APIs without discussion
- remove compatibility code without proof

## Add documentation

- When add new feature and introduce break changes, add the change to history.md.
- Update doc/coc.txt after vim interface change.
- Update doc/coc-api.txt after API change.
- Update doc/coc-config.txt after coc.nvim configuration change.

## Code Review Rules

- Report only consequential correctness, compatibility, lifecycle, concurrency, and performance issues.
- Check that public coc.nvim APIs remain stable and properly typed.
- Check Vim and Neovim behavior, buffer switching, cancellation, disposal, and asynchronous race conditions.
- Ignore formatting and lint issues already covered by CI.

## Testing

- Jest is not used by this project, never invoke Jest.
- Use `node scripts/test/cli.mjs <path_to_file>` for run specific test file.
