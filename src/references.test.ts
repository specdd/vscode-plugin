import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { SddReference } from './parser.js';
import { parseSddDocument } from './parser.js';
import {
  resolveGlobReference,
  validatePathReferences,
} from './references.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('SpecDD reference resolution', () => {
  it('resolves recursive glob references relative to the current spec', () => {
    const root = createWorkspace({
      'specs/app.sdd': '',
      'specs/src/service.ts': '',
      'specs/src/nested/repository.ts': '',
      'specs/src/nested/readme.md': '',
    });
    const currentSpecPath = path.join(root, 'specs/app.sdd');
    const reference = firstPathReference(`Spec: Glob

References:
  ./src/**/*.ts
`);

    const resolved = resolveGlobReference(reference, currentSpecPath, root, 10);

    expect(relativeMatches(root, resolved?.matches ?? [])).toEqual([
      'specs/src/nested/repository.ts',
      'specs/src/service.ts',
    ]);
    expect(resolved?.issue).toBeUndefined();
    expect(validatePathReferences(parseSddDocument(`Spec: Glob

References:
  ./src/**/*.ts
`), currentSpecPath, root, 10)).toEqual([]);
  });

  it('supports content-root globs, brace alternatives, and character classes', () => {
    const root = createWorkspace({
      'src/filea.ts': '',
      'src/fileb.ts': '',
      'src/filec.md': '',
      'src/parser.ts': '',
      'src/references.ts': '',
      'src/extension.ts': '',
      'specs/app.sdd': '',
    });
    const currentSpecPath = path.join(root, 'specs/app.sdd');
    const classReference = firstPathReference(`Spec: Character Class

References:
  /src/file[ab].ts
`);
    const braceReference = firstPathReference(`Spec: Alternatives

References:
  /src/{parser,references}.ts
`);

    expect(relativeMatches(root, resolveGlobReference(classReference, currentSpecPath, root, 10)?.matches ?? [])).toEqual([
      'src/filea.ts',
      'src/fileb.ts',
    ]);
    expect(relativeMatches(root, resolveGlobReference(braceReference, currentSpecPath, root, 10)?.matches ?? [])).toEqual([
      'src/parser.ts',
      'src/references.ts',
    ]);
  });

  it('reports malformed and unmatched glob references as warnings', () => {
    const root = createWorkspace({
      'app.sdd': '',
      'src/filea.ts': '',
    });
    const currentSpecPath = path.join(root, 'app.sdd');

    const malformed = diagnosticsFor(`Spec: Bad Glob

References:
  ./src/file[ab.ts
`, currentSpecPath, root);
    const unmatched = diagnosticsFor(`Spec: Missing Glob

References:
  ./src/*.md
`, currentSpecPath, root);

    expect(malformed.map((diagnostic) => diagnostic.code)).toContain('glob-malformed');
    expect(unmatched.map((diagnostic) => diagnostic.code)).toContain('glob-unresolved');
  });

  it('keeps glob references inside the selected content root', () => {
    const root = createWorkspace({
      'specs/app.sdd': '',
      'src/file.ts': '',
    });
    const currentSpecPath = path.join(root, 'specs/app.sdd');
    const diagnostics = diagnosticsFor(`Spec: Outside Glob

References:
  ../../*.ts
`, currentSpecPath, root);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('path-outside-content-root');
  });

  it('caps glob resolution results', () => {
    const root = createWorkspace({
      'app.sdd': '',
      'src/a.ts': '',
      'src/b.ts': '',
      'src/c.ts': '',
    });
    const currentSpecPath = path.join(root, 'app.sdd');
    const reference = firstPathReference(`Spec: Limited Glob

References:
  ./src/*.ts
`);

    const resolved = resolveGlobReference(reference, currentSpecPath, root, 2);
    const diagnostics = validatePathReferences(parseSddDocument(`Spec: Limited Glob

References:
  ./src/*.ts
`), currentSpecPath, root, 2);

    expect(resolved?.matches).toHaveLength(2);
    expect(resolved?.issue?.code).toBe('glob-result-limit');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('glob-result-limit');
  });
});

function createWorkspace(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specdd-vscode-references-'));
  roots.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }

  return root;
}

function firstPathReference(text: string): SddReference {
  const reference = parseSddDocument(text).references.find((candidate) => candidate.kind === 'path');
  if (!reference) {
    throw new Error('Expected parsed path reference.');
  }
  return reference;
}

function diagnosticsFor(text: string, currentSpecPath: string, contentRoot: string) {
  return validatePathReferences(parseSddDocument(text), currentSpecPath, contentRoot, 10);
}

function relativeMatches(root: string, matches: string[]): string[] {
  return matches.map((match) => path.relative(root, match).split(path.sep).join('/'));
}
