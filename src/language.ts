export const SDD_LANGUAGE_ID = "sdd";

export const SECTION_LABELS = [
  "Spec",
  "Platform",
  "Purpose",
  "Structure",
  "Owns",
  "Can modify",
  "Can read",
  "References",
  "Must",
  "Must not",
  "Forbids",
  "Depends on",
  "Exposes",
  "Accepts",
  "Returns",
  "Raises",
  "Handles",
  "Tasks",
  "Done when",
  "Scenario",
  "Example"
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];

export const SECTION_LABEL_SET = new Set<string>(SECTION_LABELS);

export const INLINE_VALUE_SECTIONS = new Set<SectionLabel>([
  "Spec",
  "Platform",
  "Scenario",
  "Example"
]);

export const REQUIRED_INLINE_VALUE_SECTIONS = new Set<SectionLabel>([
  "Spec",
  "Platform",
  "Scenario"
]);

export const BODYLESS_SECTIONS = new Set<SectionLabel>([
  "Spec",
  "Platform"
]);

export const REPEATABLE_SECTIONS = new Set<SectionLabel>([
  "Scenario",
  "Example"
]);

export const PATH_BEARING_SECTIONS = new Set<SectionLabel>([
  "Structure",
  "Owns",
  "Can modify",
  "Can read",
  "References",
  "Depends on",
  "Forbids",
  "Exposes"
]);

export const TASK_MARKERS = ["[ ]", "[x]", "[X]", "[-]", "[!]", "[?]"] as const;
export type TaskMarker = (typeof TASK_MARKERS)[number];

export const TASK_MARKER_LABELS: Record<TaskMarker, string> = {
  "[ ]": "open",
  "[x]": "done",
  "[X]": "done",
  "[-]": "skipped",
  "[!]": "blocked",
  "[?]": "needs decision"
};

export const SCENARIO_KEYWORDS = ["Given", "When", "Then", "And", "But"] as const;
export type ScenarioKeyword = (typeof SCENARIO_KEYWORDS)[number];

export const SECTION_DESCRIPTIONS: Record<SectionLabel, string> = {
  Spec: "Names the subject being specified. Required first section.",
  Platform: "Describes the implementation language, runtime, platform, framework, or environment.",
  Purpose: "States why the specified unit exists.",
  Structure: "Describes files and directories in the current or descendant scope.",
  Owns: "Lists files, directories, symbols, concepts, or responsibilities owned by the spec.",
  "Can modify": "Lists files or paths that may be changed when working under the spec.",
  "Can read": "Lists files, paths, specs, or prose context that may be read for context.",
  References: "Lists explicit references to other specs, contracts, or context.",
  Must: "Lists positive requirements.",
  "Must not": "Lists forbidden behavior, non-goals, and boundaries.",
  Forbids: "Lists forbidden dependencies, paths, modules, libraries, or architectural access.",
  "Depends on": "Lists dependencies, collaborators, contracts, symbols, paths, or required context.",
  Exposes: "Lists public entry points, exported symbols, APIs, contracts, or observable capabilities.",
  Accepts: "Lists accepted inputs, input types, request shapes, parameters, or preconditions.",
  Returns: "Lists return values, output types, response shapes, or result states.",
  Raises: "Lists errors, exceptions, rejected states, or failure conditions.",
  Handles: "Lists cases, events, states, branches, or conditions handled by the spec.",
  Tasks: "A local implementation checklist using supported task markers.",
  "Done when": "Lists completion criteria.",
  Scenario: "Defines a behavioral example in a Gherkin-like form.",
  Example: "Provides concrete examples, payloads, usage snippets, or expected transformations."
};

export function isSectionLabel(value: string): value is SectionLabel {
  return SECTION_LABEL_SET.has(value);
}
