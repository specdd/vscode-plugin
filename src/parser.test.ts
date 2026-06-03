import { describe, expect, it } from '@jest/globals';
import { parseSddDocument } from './parser.js';

describe('SpecDD parser', () => {
  it('parses a minimal complete spec', () => {
    const parsed = parseSddDocument('Spec: Itinerary\n');

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.label).toBe('Spec');
    expect(parsed.sections[0]?.inlineValue).toBe('Itinerary');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('normalizes continuation text into semantic body text', () => {
    const parsed = parseSddDocument(`Spec: Itinerary

Must:
  Validate itinerary input before saving
    and before updating trip days.
`);

    const must = parsed.sections.find((section) => 'Must' === section.label);
    expect(must?.entries[0]?.semanticText).toBe('Validate itinerary input before saving and before updating trip days.');
  });

  it('keeps inline trailing comments as ordinary body text', () => {
    const parsed = parseSddDocument(`Spec: Comments

Must:
  Validate input. # This is body text.
`);

    const must = parsed.sections.find((section) => 'Must' === section.label);
    expect(must?.entries[0]?.semanticText).toBe('Validate input. # This is body text.');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('reports section and inline value validation errors', () => {
    const parsed = parseSddDocument(`Purpose:
  Missing Spec first.

Spec:
Spec: Two
Must: inline text is not allowed
`);

    expectDiagnosticCodes(parsed, [
      'first-section',
      'inline-required',
      'duplicate-section',
      'inline-not-allowed',
    ]);
  });

  it('reports invalid indentation and orphan continuations', () => {
    const parsed = parseSddDocument('Spec: Bad\n\nMust:\n\tTabbed\n    orphan\n   odd\n');

    expectDiagnosticCodes(parsed, [
      'indent-tabs',
      'body-indent',
      'orphan-continuation',
      'indent-width',
    ]);
  });

  it('parses supported task states and rejects unsupported task states', () => {
    const parsed = parseSddDocument(`Spec: Tasks

Tasks:
  [ ] Write parser.
  [x] #12 Add tests.
  [z] Unknown marker.
  Plain text is invalid here.
`);

    const tasks = parsed.sections.find((section) => 'Tasks' === section.label);
    expect(tasks?.entries[0]?.task?.state).toBe('open');
    expect(tasks?.entries[1]?.task?.id).toBe('#12');
    expectDiagnosticCodes(parsed, [
      'task-state-invalid',
      'tasks-body-kind',
    ]);
  });

  it('parses scenario steps and key-value lines', () => {
    const parsed = parseSddDocument(`Spec: Scenario Spec

Scenario: missing place
  Given the place name is empty
  When the person adds a place
  Then validation fails

Example:
  input place name: Louvre
`);

    const scenario = parsed.sections.find((section) => 'Scenario' === section.label);
    const example = parsed.sections.find((section) => 'Example' === section.label);
    expect(scenario?.entries[0]?.scenarioStep?.keyword).toBe('Given');
    expect(example?.entries[0]?.keyValue?.key).toBe('input place name');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('extracts path and symbol references', () => {
    const parsed = parseSddDocument(`Spec: References

Depends on:
  ./src/parser.ts: parser source
  Call @Itinerary.addPlace before returning.
  Use \\@literal and user@example.com as prose.
  Use \`@dataclass ./src/model.py\` inside code.
`);

    const paths = parsed.references
      .filter((reference) => 'path' === reference.kind)
      .map((reference) => reference.value);
    const symbols = parsed.references
      .filter((reference) => 'symbol' === reference.kind)
      .map((reference) => reference.value);

    expect(paths).toContain('./src/parser.ts');
    expect(paths).toContain('./src/model.py');
    expect(symbols).toContain('@Itinerary.addPlace');
    expect(symbols).toContain('@dataclass');
    expect(symbols).not.toContain('@literal');
    expect(symbols).not.toContain('@example.com');
  });

  it('keeps balanced glob closers while trimming sentence punctuation', () => {
    const parsed = parseSddDocument(`Spec: Glob References

References:
  See ./src/file[ab], ./src/{parser,references}, and ./src/file].
`);

    const paths = parsed.references
      .filter((reference) => 'path' === reference.kind)
      .map((reference) => reference.value);

    expect(paths).toContain('./src/file[ab]');
    expect(paths).toContain('./src/{parser,references}');
    expect(paths).toContain('./src/file');
  });

  it('allows repeated examples but rejects duplicate scenario titles', () => {
    const parsed = parseSddDocument(`Spec: Repeats

Example:
  one

Example:
  two

Scenario: duplicate
  Given one

Scenario: duplicate
  Given two
`);

    expectDiagnosticCodes(parsed, [
      'duplicate-scenario',
    ]);
    expect(
      parsed.diagnostics.some((diagnostic) => (
        'duplicate-section' === diagnostic.code && diagnostic.message.includes('Example')
      )),
    ).toBe(false);
  });
});

const expectDiagnosticCodes = (
  parsed: ReturnType<typeof parseSddDocument>,
  expectedCodes: readonly string[],
): void => {
  const codes = parsed.diagnostics.map((diagnostic) => diagnostic.code);

  for (const code of expectedCodes) {
    expect(codes).toContain(code);
  }
};
