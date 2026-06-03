# Development

This document is for contributors working on the SpecDD VS Code extension.

For user-facing behavior, see `README.md`. For source-adjacent requirements, read the relevant `.sdd` specs before editing code.

## Prerequisites

- Node.js 22 or newer.
- Yarn 1.x. The project currently declares `yarn@1.22.22`.
- Visual Studio Code compatible with the `engines.vscode` range in `package.json`.

Install dependencies:

```bash
make install
```

## Architecture

The extension is split between a thin VS Code adapter layer and pure language services.

```text
src/extension.ts
  -> parser.ts
  -> references.ts
  -> language.ts
```

`src/extension.ts` owns VS Code activation, provider registration, diagnostics conversion, commands, and editor-facing behavior.

`src/parser.ts` owns line-oriented `.sdd` parsing, semantic body text normalization, strict syntax diagnostics, and explicit reference extraction. It must not import VS Code APIs.

`src/references.ts` owns content-root selection, explicit path resolution, related-spec lookup, and warning-level reference diagnostics. It must not import VS Code APIs.

`src/language.ts` owns shared labels, task markers, scenario keywords, and section metadata.

## Project Layout

```text
vscode-plugin.sdd              root project spec
src/src.sdd                    source tree spec
src/extension.ts               VS Code activation, providers, diagnostics, and commands
src/extension.sdd              extension entrypoint spec
src/parser.ts                  pure parser and validator
src/parser.sdd                 parser spec
src/parser.test.ts             parser tests
src/references.ts              content-root and reference helpers
src/references.sdd             reference resolution spec
src/language.ts                shared language metadata
src/language.sdd               language metadata spec
syntaxes/sdd.tmLanguage.json   TextMate grammar
language-configuration.json    VS Code language configuration
Makefile                       build, package, and release automation
```

## Development Commands

Run the full local build and package check:

```bash
make build
```

Run type checking:

```bash
make typecheck
```

Run tests:

```bash
make test
```

Run tests with coverage:

```bash
make coverage
```

Build:

```bash
make dist
```

Package a local VSIX:

```bash
make package
```

The package target runs the prepublish build and writes `specdd-<version>.vsix`.

Run release preflight checks:

```bash
make release-preflight
```

Create a GitHub release for the current version and attach the VSIX:

```bash
make github-release
```

`make release` is an alias for the GitHub release flow. It requires a clean, pushed branch and an authenticated GitHub CLI. Release notes are extracted from the matching `CHANGELOG.md` entry. The generated VSIX can be uploaded manually through registry UIs when needed.

## Local Extension Smoke Check

Open this repository in VS Code and run the `Extension` launch configuration. In the extension host window, open or create a `.sdd` file and verify highlighting, diagnostics, completions, document symbols, folding, hovers, links, and commands.

The launch configuration runs the build task first and loads the compiled extension from `dist/extension.js`.

## Changelog

Maintain `CHANGELOG.md` in Common Changelog style. Release entries use:

```markdown
## [VERSION] - YYYY-MM-DD
```

Use the package version without a leading `v`, keep entries latest-first, and group changes with categories such as `Added`, `Changed`, `Removed`, and `Fixed`.

## Security Choices

Dependency security is intentionally conservative:

- Direct development dependencies are pinned to exact versions in `package.json`.
- `yarn.lock` is committed and should be updated with dependency changes.
- Runtime extension code currently has no external package dependencies.
- The VSIX package contents are checked with `make package-check`.
- GitHub and registry credentials must not be committed.

Extension behavior should stay local and predictable:

- Normal activation must not fetch remote resources.
- Parser and reference logic must not shell out to external commands.
- Path resolution must keep targets inside the selected content root unless reporting a warning.

## Adding Behavior

Start with the smallest relevant spec. For substantial source behavior, add or update the same-basename `.sdd` file next to the TypeScript file.

Keep boundaries explicit:

- VS Code API usage belongs in `extension.ts`.
- Language constants belong in `language.ts`.
- Syntax parsing and validation belong in `parser.ts`.
- Filesystem and related-spec resolution belong in `references.ts`.
