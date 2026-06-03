import {
  BODYLESS_SECTIONS,
  INLINE_VALUE_SECTIONS,
  PATH_BEARING_SECTIONS,
  REQUIRED_INLINE_VALUE_SECTIONS,
  REPEATABLE_SECTIONS,
  SCENARIO_KEYWORDS,
  SECTION_LABELS,
  TASK_MARKERS,
  TASK_MARKER_LABELS,
  type ScenarioKeyword,
  type SectionLabel,
  type TaskMarker,
  isSectionLabel
} from "./language.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface SddDiagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  range: Range;
}

export type BodyEntryKind = "task" | "scenario-step" | "key-value" | "text" | "invalid";

export interface ContinuationLine {
  line: number;
  text: string;
  range: Range;
}

export interface TaskInfo {
  marker: TaskMarker;
  state: string;
  id: string | undefined;
  text: string;
}

export interface ScenarioStepInfo {
  keyword: ScenarioKeyword;
  text: string;
}

export interface KeyValueInfo {
  key: string;
  value: string;
}

export interface BodyEntry {
  kind: BodyEntryKind;
  line: number;
  section: SectionLabel;
  raw: string;
  text: string;
  semanticText: string;
  range: Range;
  continuations: ContinuationLine[];
  task?: TaskInfo;
  scenarioStep?: ScenarioStepInfo;
  keyValue?: KeyValueInfo;
}

export interface Section {
  label: SectionLabel;
  inlineValue: string | undefined;
  startLine: number;
  endLine: number;
  headerRange: Range;
  entries: BodyEntry[];
}

export type SddReferenceKind = "path" | "symbol";

export interface SddReference {
  kind: SddReferenceKind;
  value: string;
  range: Range;
  line: number;
  section: SectionLabel | undefined;
  isGlob: boolean;
}

export interface ParsedSddDocument {
  text: string;
  lines: string[];
  sections: Section[];
  diagnostics: SddDiagnostic[];
  references: SddReference[];
}

const SECTION_ORDER = new Map<string, number>(
  SECTION_LABELS.map((label, index) => [label, index])
);

const GLOB_METACHARS = new Set(["*", "?", "[", "]", "{", "}"]);

export function parseSddDocument(text: string): ParsedSddDocument {
  const lines = splitLines(text);
  const diagnostics: SddDiagnostic[] = [];
  const sections: Section[] = [];
  const references: SddReference[] = [];
  const referenceKeys = new Set<string>();
  const seenNonRepeatable = new Map<SectionLabel, number>();
  const seenScenarios = new Map<string, number>();
  let currentSection: Section | undefined;
  let lastEntry: BodyEntry | undefined;
  let firstSectionSeen = false;

  const addDiagnostic = (
    code: string,
    message: string,
    line: number,
    start = 0,
    end = Math.max(lines[line]?.length ?? 0, start + 1),
    severity: DiagnosticSeverity = "error"
  ) => {
    diagnostics.push({
      code,
      message,
      severity,
      range: createRange(line, start, end)
    });
  };

  const addReference = (reference: SddReference) => {
    const key = `${reference.kind}:${reference.line}:${reference.range.start.character}:${reference.value}`;
    if (!referenceKeys.has(key)) {
      referenceKeys.add(key);
      references.push(reference);
    }
  };

  const closeCurrentSection = (endLine: number) => {
    if (currentSection) {
      currentSection.endLine = Math.max(currentSection.startLine, endLine);
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    const leadingWhitespace = getLeadingWhitespace(line);
    const indentWidth = leadingWhitespace.length;

    if (trimmed.length === 0 || isCommentLine(line)) {
      continue;
    }

    if (!isCommentLine(line)) {
      if (leadingWhitespace.includes("\t")) {
        addDiagnostic(
          "indent-tabs",
          "Non-comment indentation must use spaces only.",
          lineIndex,
          0,
          leadingWhitespace.length
        );
      }
      if (!leadingWhitespace.includes("\t") && indentWidth % 2 !== 0) {
        addDiagnostic(
          "indent-width",
          "Non-comment indentation width must be a multiple of 2 spaces.",
          lineIndex,
          0,
          leadingWhitespace.length
        );
      }
    }

    const indentedHeader = parseKnownSectionHeader(trimmed);
    if (indentWidth > 0 && indentedHeader) {
      addDiagnostic(
        "indented-section-header",
        "Section headers must start at column 0.",
        lineIndex,
        0,
        indentWidth + indentedHeader.label.length + 1
      );
      continue;
    }

    const whitespaceBeforeColon = parseKnownSectionWithWhitespaceBeforeColon(line);
    if (indentWidth === 0 && whitespaceBeforeColon) {
      addDiagnostic(
        "section-colon-whitespace",
        `Whitespace before ':' is invalid in the '${whitespaceBeforeColon}' section header.`,
        lineIndex,
        0,
        line.indexOf(":") + 1
      );
      continue;
    }

    const header = indentWidth === 0 ? parseKnownSectionHeader(line) : undefined;
    if (header) {
      closeCurrentSection(lineIndex - 1);
      lastEntry = undefined;

      if (!firstSectionSeen) {
        firstSectionSeen = true;
        if (header.label !== "Spec") {
          addDiagnostic(
            "first-section",
            "The first section in a complete .sdd file must be 'Spec'.",
            lineIndex,
            0,
            header.label.length
          );
        }
      }

      const section: Section = {
        label: header.label,
        inlineValue: header.inlineValue,
        startLine: lineIndex,
        endLine: lineIndex,
        headerRange: createRange(lineIndex, 0, line.length),
        entries: []
      };
      sections.push(section);
      currentSection = section;
      validateHeader(header, section, seenNonRepeatable, seenScenarios, addDiagnostic);
      if (header.inlineValue) {
        collectReferences(header.inlineValue, lineIndex, header.inlineStart, header.label).forEach(addReference);
      }
      continue;
    }

    if (indentWidth === 0) {
      const unknownHeader = parseUnknownHeader(line);
      if (unknownHeader) {
        addDiagnostic(
          "unknown-section",
          `Unknown section '${unknownHeader}'.`,
          lineIndex,
          0,
          unknownHeader.length
        );
        continue;
      }

      const missingColonLabel = knownSectionMissingColon(line);
      if (missingColonLabel) {
        addDiagnostic(
          "section-missing-colon",
          `Known section '${missingColonLabel}' is missing ':'.`,
          lineIndex,
          0,
          missingColonLabel.length
        );
        continue;
      }
    }

    if (!currentSection) {
      addDiagnostic(
        "text-before-section",
        "Only blank lines and comments may appear before the first section.",
        lineIndex,
        0,
        line.length
      );
      continue;
    }

    if (indentWidth >= 4) {
      if (!lastEntry || lastEntry.section !== currentSection.label) {
        addDiagnostic(
          "orphan-continuation",
          "Continuation lines require a preceding body entry in the current section.",
          lineIndex,
          0,
          line.length
        );
        continue;
      }

      const continuationText = line.slice(indentWidth);
      const continuation: ContinuationLine = {
        line: lineIndex,
        text: continuationText,
        range: createRange(lineIndex, indentWidth, line.length)
      };
      lastEntry.continuations.push(continuation);
      collectReferences(continuationText, lineIndex, indentWidth, currentSection.label).forEach(addReference);
      continue;
    }

    if (indentWidth !== 2) {
      addDiagnostic(
        "body-indent",
        "Body entry lines must use exactly 2 spaces of indentation.",
        lineIndex,
        0,
        Math.max(line.length, 1)
      );
      lastEntry = undefined;
      continue;
    }

    const content = line.slice(2);
    const entry = classifyBodyEntry(content, lineIndex, currentSection.label, addDiagnostic);
    currentSection.entries.push(entry);
    lastEntry = entry;

    if (BODYLESS_SECTIONS.has(currentSection.label)) {
      addDiagnostic(
        "bodyless-section-body",
        `'${currentSection.label}' must not have body lines.`,
        lineIndex,
        0,
        line.length
      );
    }

    collectEntryReferences(entry, currentSection.label).forEach(addReference);
  }

  closeCurrentSection(lines.length - 1);

  for (const section of sections) {
    for (const entry of section.entries) {
      entry.semanticText = normalizeEntryText(entry);
    }
  }

  return {
    text,
    lines,
    sections,
    diagnostics,
    references
  };
}

function validateHeader(
  header: ParsedHeader,
  section: Section,
  seenNonRepeatable: Map<SectionLabel, number>,
  seenScenarios: Map<string, number>,
  addDiagnostic: (
    code: string,
    message: string,
    line: number,
    start?: number,
    end?: number,
    severity?: DiagnosticSeverity
  ) => void
) {
  const value = header.inlineValue?.trim() ?? "";

  if (header.inlineSeparatorMissing) {
    addDiagnostic(
      "inline-separator",
      "Inline values must be separated from ':' by at least one space.",
      section.startLine,
      header.label.length,
      Math.max(header.label.length + 1, header.inlineEnd)
    );
  }

  if (!INLINE_VALUE_SECTIONS.has(header.label) && header.rawInline.length > 0) {
    addDiagnostic(
      "inline-not-allowed",
      `'${header.label}' must not contain inline text after ':'.`,
      section.startLine,
      header.label.length,
      header.inlineEnd
    );
  }

  if (REQUIRED_INLINE_VALUE_SECTIONS.has(header.label) && value.length === 0) {
    addDiagnostic(
      "inline-required",
      `'${header.label}' must have a nonempty inline value.`,
      section.startLine,
      0,
      header.inlineEnd
    );
  }

  if (!REPEATABLE_SECTIONS.has(header.label)) {
    const firstLine = seenNonRepeatable.get(header.label);
    if (firstLine !== undefined) {
      addDiagnostic(
        "duplicate-section",
        `'${header.label}' may not repeat. First occurrence is on line ${firstLine + 1}.`,
        section.startLine,
        0,
        header.label.length
      );
    } else {
      seenNonRepeatable.set(header.label, section.startLine);
    }
  }

  if (header.label === "Scenario") {
    const title = value;
    const firstLine = seenScenarios.get(title);
    if (firstLine !== undefined) {
      addDiagnostic(
        "duplicate-scenario",
        `Scenario '${title}' already appears on line ${firstLine + 1}.`,
        section.startLine,
        0,
        header.inlineEnd
      );
    } else if (title.length > 0) {
      seenScenarios.set(title, section.startLine);
    }
  }
}

function classifyBodyEntry(
  content: string,
  line: number,
  section: SectionLabel,
  addDiagnostic: (
    code: string,
    message: string,
    line: number,
    start?: number,
    end?: number,
    severity?: DiagnosticSeverity
  ) => void
): BodyEntry {
  const baseEntry: BodyEntry = {
    kind: "text",
    line,
    section,
    raw: content,
    text: content,
    semanticText: content.trim(),
    range: createRange(line, 2, content.length + 2),
    continuations: []
  };

  if (section === "Tasks") {
    const task = parseTask(content);
    if (task.ok) {
      if (task.info.text.trim().length === 0) {
        addDiagnostic(
          "task-text-missing",
          "Task lines must include task text.",
          line,
          2,
          content.length + 2
        );
      }
      return {
        ...baseEntry,
        kind: "task",
        task: task.info
      };
    }

    if (content.startsWith("[")) {
      addDiagnostic(
        "task-state-invalid",
        task.message,
        line,
        2,
        Math.min(content.length + 2, 5)
      );
    } else {
      addDiagnostic(
        "tasks-body-kind",
        "The Tasks section accepts task lines only.",
        line,
        2,
        content.length + 2
      );
    }
    return {
      ...baseEntry,
      kind: "invalid"
    };
  }

  const scenarioStep = parseScenarioStep(content);
  if (scenarioStep) {
    return {
      ...baseEntry,
      kind: "scenario-step",
      scenarioStep
    };
  }

  const keyValue = parseKeyValue(content);
  if (keyValue) {
    return {
      ...baseEntry,
      kind: "key-value",
      keyValue
    };
  }

  return baseEntry;
}

function parseTask(content: string): { ok: true; info: TaskInfo } | { ok: false; message: string } {
  const marker = content.slice(0, 3);
  if (!TASK_MARKERS.includes(marker as TaskMarker)) {
    return {
      ok: false,
      message: "Unsupported task marker. Use [ ], [x], [X], [-], [!], or [?]."
    };
  }

  const rawRest = content.slice(3);
  if (rawRest.length > 0 && !rawRest.startsWith(" ")) {
    return {
      ok: false,
      message: "Task marker must be followed by whitespace and task text."
    };
  }

  let rest = rawRest.trimStart();
  let id: string | undefined;
  const idMatch = /^#\d+(?=\s|$)/.exec(rest);
  if (idMatch) {
    id = idMatch[0];
    rest = rest.slice(id.length).trimStart();
  }

  return {
    ok: true,
    info: {
      marker: marker as TaskMarker,
      state: TASK_MARKER_LABELS[marker as TaskMarker],
      id,
      text: rest
    }
  };
}

function parseScenarioStep(content: string): ScenarioStepInfo | undefined {
  for (const keyword of SCENARIO_KEYWORDS) {
    if (content === keyword || content.startsWith(`${keyword} `) || content.startsWith(`${keyword}\t`)) {
      return {
        keyword,
        text: content.slice(keyword.length).trimStart()
      };
    }
  }
  return undefined;
}

function parseKeyValue(content: string): KeyValueInfo | undefined {
  const separator = content.indexOf(": ");
  if (separator <= 0) {
    return undefined;
  }

  const key = content.slice(0, separator);
  if (key.trimEnd() !== key) {
    return undefined;
  }

  return {
    key,
    value: content.slice(separator + 2)
  };
}

function collectEntryReferences(entry: BodyEntry, section: SectionLabel): SddReference[] {
  const references = collectReferences(entry.text, entry.line, 2, section);

  if (PATH_BEARING_SECTIONS.has(section)) {
    const candidate = explicitPathCandidateForEntry(entry);
    if (candidate) {
      references.push({
        kind: "path",
        value: candidate.value,
        range: createRange(entry.line, candidate.start, candidate.start + candidate.value.length),
        line: entry.line,
        section,
        isGlob: containsGlob(candidate.value)
      });
    }
  }

  return dedupeReferences(references);
}

function explicitPathCandidateForEntry(entry: BodyEntry): { value: string; start: number } | undefined {
  if (entry.keyValue && hasExplicitPathPrefix(entry.keyValue.key)) {
    return {
      value: entry.keyValue.key,
      start: 2
    };
  }

  const leadingWhitespace = /^\s*/.exec(entry.text)?.[0].length ?? 0;
  const trimmed = entry.text.trimStart();
  if (hasExplicitPathPrefix(trimmed)) {
    const value = readPathLike(trimmed, 0);
    return {
      value,
      start: 2 + leadingWhitespace
    };
  }

  return undefined;
}

function collectReferences(text: string, line: number, baseCharacter: number, section?: SectionLabel): SddReference[] {
  return dedupeReferences([
    ...collectSymbolReferences(text, line, baseCharacter, section),
    ...collectPathReferences(text, line, baseCharacter, section)
  ]);
}

function collectSymbolReferences(
  text: string,
  line: number,
  baseCharacter: number,
  section?: SectionLabel
): SddReference[] {
  const references: SddReference[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") {
      continue;
    }

    if (index > 0 && text[index - 1] === "\\") {
      continue;
    }

    const previous = index === 0 ? "" : text[index - 1] ?? "";
    if (index > 0 && !isSymbolBoundary(previous)) {
      continue;
    }

    const firstSymbolChar = text[index + 1] ?? "";
    if (!/^[A-Za-z_]$/.test(firstSymbolChar)) {
      continue;
    }

    let end = index + 2;
    while (end < text.length && /^[A-Za-z0-9_.:#\\/?!]$/.test(text[end] ?? "")) {
      end += 1;
    }

    let valueEnd = end;
    const next = text[end] ?? "";
    if (
      text[valueEnd - 1] === "." &&
      (next === "" || /\s/.test(next) || isClosingPunctuation(next))
    ) {
      valueEnd -= 1;
    }

    if (valueEnd <= index + 1) {
      continue;
    }

    const value = text.slice(index, valueEnd);
    references.push({
      kind: "symbol",
      value,
      range: createRange(line, baseCharacter + index, baseCharacter + valueEnd),
      line,
      section,
      isGlob: false
    });
  }

  return references;
}

function collectPathReferences(
  text: string,
  line: number,
  baseCharacter: number,
  section?: SectionLabel
): SddReference[] {
  const references: SddReference[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (!hasExplicitPathPrefix(text.slice(index))) {
      continue;
    }

    const previous = index === 0 ? "" : text[index - 1] ?? "";
    if (index > 0 && !isPathBoundary(previous)) {
      continue;
    }

    const value = trimPathPunctuation(readPathLike(text, index));
    if (value.length === 0) {
      continue;
    }

    references.push({
      kind: "path",
      value,
      range: createRange(line, baseCharacter + index, baseCharacter + index + value.length),
      line,
      section,
      isGlob: containsGlob(value)
    });
    index += value.length - 1;
  }

  return references;
}

function normalizeEntryText(entry: BodyEntry): string {
  const segments = [entry.text, ...entry.continuations.map((continuation) => continuation.text)]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.join(" ");
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function getLeadingWhitespace(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

interface ParsedHeader {
  label: SectionLabel;
  inlineValue: string | undefined;
  rawInline: string;
  inlineStart: number;
  inlineEnd: number;
  inlineSeparatorMissing: boolean;
}

function parseKnownSectionHeader(line: string): ParsedHeader | undefined {
  for (const label of [...SECTION_LABELS].sort((a, b) => b.length - a.length)) {
    if (!line.startsWith(`${label}:`)) {
      continue;
    }

    const rawInline = line.slice(label.length + 1);
    const inlineSeparatorMissing = rawInline.length > 0 && !rawInline.startsWith(" ");
    const inlineStart = label.length + 1 + (rawInline.match(/^\s+/)?.[0].length ?? 0);
    const inlineValue = rawInline.length === 0 ? undefined : rawInline.trim();
    return {
      label,
      inlineValue,
      rawInline,
      inlineStart,
      inlineEnd: line.length,
      inlineSeparatorMissing
    };
  }

  return undefined;
}

function parseKnownSectionWithWhitespaceBeforeColon(line: string): SectionLabel | undefined {
  for (const label of [...SECTION_LABELS].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`^${escapeRegExp(label)}\\s+:`);
    if (pattern.test(line)) {
      return label;
    }
  }
  return undefined;
}

function parseUnknownHeader(line: string): string | undefined {
  const match = /^([^:\s][^:]*):(?:\s.*)?$/.exec(line);
  if (!match) {
    return undefined;
  }

  const label = match[1] ?? "";
  return isSectionLabel(label) ? undefined : label;
}

function knownSectionMissingColon(line: string): SectionLabel | undefined {
  for (const label of [...SECTION_LABELS].sort((a, b) => b.length - a.length)) {
    if (line === label || line.startsWith(`${label} `)) {
      return label;
    }
  }
  return undefined;
}

function createRange(line: number, start: number, end: number): Range {
  return {
    start: {
      line,
      character: Math.max(0, start)
    },
    end: {
      line,
      character: Math.max(Math.max(0, start), end)
    }
  };
}

function hasExplicitPathPrefix(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith("/");
}

function readPathLike(text: string, start: number): string {
  let end = start;
  while (end < text.length && !/\s/.test(text[end] ?? "") && text[end] !== "`") {
    end += 1;
  }
  return text.slice(start, end);
}

function trimPathPunctuation(value: string): string {
  let end = value.length;
  while (end > 0) {
    const terminal = value[end - 1] ?? "";
    if (!/[.,;:)\]}>]/u.test(terminal)) {
      break;
    }
    if (terminal === "]" && terminalClosesGlobPair(value.slice(0, end), "[", "]")) {
      break;
    }
    if (terminal === "}" && terminalClosesGlobPair(value.slice(0, end), "{", "}")) {
      break;
    }
    end -= 1;
  }
  return value.slice(0, end);
}

function containsGlob(value: string): boolean {
  return [...value].some((char) => GLOB_METACHARS.has(char));
}

function terminalClosesGlobPair(value: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of value.slice(0, -1)) {
    if (char === open) {
      depth += 1;
    } else if (char === close && depth > 0) {
      depth -= 1;
    }
  }
  return value.endsWith(close) && depth > 0;
}

function isSymbolBoundary(char: string): boolean {
  return /\s/.test(char) || ["(", "[", "{", "<", "\"", "'", "`"].includes(char);
}

function isPathBoundary(char: string): boolean {
  return /\s/.test(char) || ["(", "[", "{", "<", "\"", "'", "`"].includes(char);
}

function isClosingPunctuation(char: string): boolean {
  return [")", "]", "}", ">", "\"", "'"].includes(char);
}

function dedupeReferences(references: SddReference[]): SddReference[] {
  const seen = new Set<string>();
  const result: SddReference[] = [];
  for (const reference of references) {
    const key = `${reference.kind}:${reference.line}:${reference.range.start.character}:${reference.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(reference);
    }
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compareSectionOrder(left: SectionLabel, right: SectionLabel): number {
  return (SECTION_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) - (SECTION_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER);
}
