PACKAGE := $(shell node -p "require('./package.json').name")
PACKAGE_VERSION := $(shell node -p "require('./package.json').version")
VSIX := $(PACKAGE)-$(PACKAGE_VERSION).vsix
YARN ?= yarn
VSCE ?= ./node_modules/.bin/vsce
GH ?= gh
VSCE_LIST_FLAGS ?= --no-yarn --no-dependencies
GITHUB_RELEASE_TAG ?= $(PACKAGE_VERSION)
GITHUB_RELEASE_TITLE ?= $(PACKAGE_VERSION)
GITHUB_RELEASE_NOTES ?= /tmp/$(PACKAGE)-$(PACKAGE_VERSION)-release-notes.md
CONFIRM = printf '%s [y/N] ' "$(1)"; read -r answer; case "$$answer" in [yY]|[yY][eE][sS]) ;; *) echo "Aborted."; exit 1 ;; esac

.PHONY: build install audit typecheck test coverage dist package package-check package-list clean changelog-check release-notes release-preflight github-release release

build: install typecheck test dist package-check

install:
	$(YARN) install --frozen-lockfile

audit:
	$(YARN) audit --groups "dependencies devDependencies"

typecheck:
	$(YARN) typecheck

test:
	$(YARN) test

coverage:
	$(YARN) test:coverage

dist:
	$(YARN) build

package: dist
	$(YARN) package

package-check: package
	test -s "$(VSIX)"
	$(VSCE) ls $(VSCE_LIST_FLAGS) --tree >/dev/null

package-list:
	$(VSCE) ls $(VSCE_LIST_FLAGS) --tree

clean:
	rm -rf dist .vscode-test *.vsix

changelog-check:
	grep -q "^## \\[$(PACKAGE_VERSION)\\] -" CHANGELOG.md

release-notes: changelog-check
	awk -v version="$(PACKAGE_VERSION)" 'BEGIN { capture = 0 } /^## \[/ { if (capture) exit; if ($$0 ~ "^## \\[" version "\\]") { capture = 1; next } } capture { print }' CHANGELOG.md > "$(GITHUB_RELEASE_NOTES)"
	test -s "$(GITHUB_RELEASE_NOTES)"

release-preflight: changelog-check
	@git rev-parse --is-inside-work-tree >/dev/null
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Release preflight failed: uncommitted changes are present."; \
		git status --short; \
		exit 1; \
	fi
	@upstream=$$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null) || { \
		echo "Release preflight failed: current branch has no upstream configured."; \
		exit 1; \
	}; \
	unpushed_count=$$(git rev-list --count "$$upstream"..HEAD); \
	if [ "$$unpushed_count" -ne 0 ]; then \
		echo "Release preflight failed: $$unpushed_count commit(s) have not been pushed to $$upstream."; \
		git log --oneline "$$upstream"..HEAD; \
		exit 1; \
	fi

github-release: release-preflight build release-notes
	@$(call CONFIRM,Create GitHub release $(GITHUB_RELEASE_TAG) with $(VSIX)?)
	$(GH) release create "$(GITHUB_RELEASE_TAG)" "$(VSIX)" --title "$(GITHUB_RELEASE_TITLE)" --notes-file "$(GITHUB_RELEASE_NOTES)"

release: github-release
