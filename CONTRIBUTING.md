# Contributing

Thank you for your interest in contributing. Bug reports, implementation proposals, documentation improvements, and pull requests are welcome.

## Before You Start

Read `README.md` for user-facing behavior and `DEVELOPMENT.md` for project architecture and local development commands.

This project uses SpecDD. Before changing code, read the relevant `.sdd` specs next to the code or files you plan to edit. Specs are source-adjacent development contracts.

## Issues and Discussions

Use the project issue tracker for extension bugs, feature requests, and implementation proposals. If an idea is still open-ended, start with a discussion before investing in a larger change.

For broader SpecDD framework questions, use the main SpecDD project resources.

## Pull Requests

Keep pull requests focused. Update specs, tests, and documentation together with behavior changes.

Before submitting, run:

```bash
make build
```

`make build` installs dependencies from the lockfile, typechecks, tests, builds, and verifies package contents.

Release artifacts are handled by the Makefile. Maintainers can use `make release` to create the GitHub release and attach the packaged VSIX.

## Security

Do not report security issues in public issues or pull requests. See `SECURITY.md`.

## License

By contributing to this project, you agree that your contributions will be licensed under the Apache License 2.0.
