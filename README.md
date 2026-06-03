# SpecDD for Visual Studio Code

Specification-Driven Development support for source-adjacent `.sdd` specs.

## Links

- Homepage: https://specdd.ai
- Repository: https://github.com/specdd/vscode-plugin

## Features

- Registers `.sdd` files as SpecDD documents.
- Semantic syntax highlighting for section groups, comments, task states, scenario steps, key-value entries, paths, globs, symbol references, and inline code spans.
- Strict diagnostics for SpecDD language rules such as section order, inline values, duplicate sections, indentation, task markers, and continuation lines.
- Document symbols and folding ranges for sections, scenarios, examples, and tasks.
- Completions for section headers, task markers, and scenario step keywords.
- Hovers for section labels, task markers, explicit paths, and symbol references.
- Document links for resolvable exact path references and glob references. Single glob matches open directly; multiple matches open a picker.
- Commands for opening related specs, creating matching specs, validating the workspace, and showing the selected content root.
- SpecDD extension and file icons.

## Commands

- `SpecDD: Open Related Spec`
- `SpecDD: Create Matching Spec`
- `SpecDD: Validate Workspace`
- `SpecDD: Show Content Root`

## Settings

- `specdd.contentRoot`: Explicit content root for resolving `/` paths.
- `specdd.diagnostics.enabled`: Enable strict syntax diagnostics.
- `specdd.references.validate`: Warn for unresolved explicit path references.
- `specdd.references.maxGlobResults`: Limit filesystem entries considered for each glob reference.

## Packaging

```sh
make build
```

`make build` installs from the lockfile, typechecks, tests, builds, packages the VSIX, and verifies package contents.

```sh
make release
```

`make release` creates a GitHub release for the current package version and attaches the generated VSIX. Registry uploads can be done manually from that VSIX.

## Development

```sh
yarn install
yarn build
yarn test
```
