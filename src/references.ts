import * as fs from "node:fs";
import * as path from "node:path";
import type { ParsedSddDocument, SddDiagnostic, SddReference } from "./parser.js";

export interface RelatedSpecResult {
  specs: string[];
  issues: string[];
}

export interface ResolvedPathReference {
  reference: SddReference;
  absolutePath: string;
  insideContentRoot: boolean;
  exists: boolean;
}

export interface GlobResolutionIssue {
  code: "glob-malformed" | "glob-unresolved" | "glob-result-limit";
  message: string;
}

export interface ResolvedGlobReference {
  reference: SddReference;
  absolutePattern: string;
  insideContentRoot: boolean;
  matches: string[];
  issue?: GlobResolutionIssue;
}

export function resolveContentRoot(
  currentFilePath: string,
  workspaceFolders: string[],
  configuredRoot?: string | null
): string {
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(configuredRoot);
  }

  const absoluteFile = path.resolve(currentFilePath);
  const containingWorkspaceFolders = workspaceFolders
    .map((folder) => path.resolve(folder))
    .filter((folder) => isInsideOrEqual(absoluteFile, folder))
    .sort((left, right) => right.length - left.length);

  if (containingWorkspaceFolders.length > 0) {
    return containingWorkspaceFolders[0]!;
  }

  return discoverGitRoot(path.dirname(absoluteFile)) ?? path.dirname(absoluteFile);
}

export function resolvePathReference(
  reference: SddReference,
  currentSpecPath: string,
  contentRoot: string
): ResolvedPathReference | undefined {
  if (reference.kind !== "path") {
    return undefined;
  }

  const absolutePath = reference.value.startsWith("/")
    ? path.resolve(contentRoot, `.${reference.value}`)
    : path.resolve(path.dirname(currentSpecPath), reference.value);

  const insideContentRoot = isInsideOrEqual(absolutePath, contentRoot);
  return {
    reference,
    absolutePath,
    insideContentRoot,
    exists: fs.existsSync(absolutePath)
  };
}

export function validatePathReferences(
  parsed: ParsedSddDocument,
  currentSpecPath: string,
  contentRoot: string,
  maxGlobResults: number
): SddDiagnostic[] {
  const diagnostics: SddDiagnostic[] = [];
  for (const reference of parsed.references) {
    if (reference.kind !== "path") {
      continue;
    }

    if (reference.isGlob) {
      const resolvedGlob = resolveGlobReference(reference, currentSpecPath, contentRoot, maxGlobResults);
      if (!resolvedGlob) {
        continue;
      }
      if (!resolvedGlob.insideContentRoot) {
        diagnostics.push({
          code: "path-outside-content-root",
          message: `Path reference '${reference.value}' resolves outside the SpecDD content root.`,
          severity: "warning",
          range: reference.range
        });
        continue;
      }
      if (resolvedGlob.issue) {
        diagnostics.push({
          code: resolvedGlob.issue.code,
          message: resolvedGlob.issue.message,
          severity: "warning",
          range: reference.range
        });
      }
      continue;
    }

    const resolved = resolvePathReference(reference, currentSpecPath, contentRoot);
    if (!resolved) {
      continue;
    }

    if (!resolved.insideContentRoot) {
      diagnostics.push({
        code: "path-outside-content-root",
        message: `Path reference '${reference.value}' resolves outside the SpecDD content root.`,
        severity: "warning",
        range: reference.range
      });
      continue;
    }

    if (!resolved.exists) {
      diagnostics.push({
        code: "path-unresolved",
        message: `Path reference '${reference.value}' does not resolve to an existing file or directory.`,
        severity: "warning",
        range: reference.range
      });
    }
  }
  return diagnostics;
}

export function resolveDocumentLinkTarget(
  reference: SddReference,
  currentSpecPath: string,
  contentRoot: string
): string | undefined {
  if (reference.kind !== "path" || reference.isGlob) {
    return undefined;
  }

  const resolved = resolvePathReference(reference, currentSpecPath, contentRoot);
  if (!resolved?.insideContentRoot || !resolved.exists) {
    return undefined;
  }

  return resolved.absolutePath;
}

export function resolveGlobReference(
  reference: SddReference,
  currentSpecPath: string,
  contentRoot: string,
  maxGlobResults: number
): ResolvedGlobReference | undefined {
  if (reference.kind !== "path" || !reference.isGlob) {
    return undefined;
  }

  const resolved = resolvePathReference(reference, currentSpecPath, contentRoot);
  if (!resolved) {
    return undefined;
  }

  const absolutePattern = resolved.absolutePath;
  const insideContentRoot = resolved.insideContentRoot;
  if (!insideContentRoot) {
    return {
      reference,
      absolutePattern,
      insideContentRoot,
      matches: []
    };
  }

  const normalizedPattern = toPosixPath(absolutePattern);
  const compiled = compileGlobPattern(normalizedPattern);
  if (!compiled.ok) {
    return {
      reference,
      absolutePattern,
      insideContentRoot,
      matches: [],
      issue: {
        code: "glob-malformed",
        message: compiled.issue
      }
    };
  }

  const maxMatches = Math.max(1, Math.floor(maxGlobResults));
  const searchRoot = globSearchRoot(absolutePattern, contentRoot);
  const matches = findMatches(searchRoot, compiled.matcher, maxMatches + 1);
  if (matches.length === 0) {
    return {
      reference,
      absolutePattern,
      insideContentRoot,
      matches: [],
      issue: {
        code: "glob-unresolved",
        message: "Glob reference does not match any existing files or directories."
      }
    };
  }

  if (matches.length > maxMatches) {
    return {
      reference,
      absolutePattern,
      insideContentRoot,
      matches: matches.slice(0, maxMatches),
      issue: {
        code: "glob-result-limit",
        message: `Glob reference matched more than ${maxMatches} filesystem entries.`
      }
    };
  }

  return {
    reference,
    absolutePattern,
    insideContentRoot,
    matches
  };
}

export function resolveRelatedSpecsForTarget(targetPath: string, contentRoot: string): RelatedSpecResult {
  const absoluteTarget = path.resolve(targetPath);
  const issues: string[] = [];
  const specs: string[] = [];

  if (!fs.existsSync(absoluteTarget)) {
    return {
      specs,
      issues: [`Target does not exist: ${absoluteTarget}`]
    };
  }

  const stat = fs.statSync(absoluteTarget);
  const targetDirectory = stat.isDirectory() ? absoluteTarget : path.dirname(absoluteTarget);

  for (const issueOrSpec of resolveVerticalDirectorySpecs(contentRoot, targetDirectory)) {
    if (typeof issueOrSpec === "string") {
      specs.push(issueOrSpec);
    } else {
      issues.push(issueOrSpec.message);
    }
  }

  if (stat.isFile()) {
    if (absoluteTarget.toLowerCase().endsWith(".sdd")) {
      specs.push(absoluteTarget);
    } else {
      const matchingSpec = findMatchingSpecForFile(absoluteTarget);
      if (matchingSpec.kind === "found") {
        specs.push(matchingSpec.path);
      } else if (matchingSpec.kind === "ambiguous") {
        issues.push(matchingSpec.message);
      }
    }
  }

  return {
    specs: dedupePaths(specs).filter((spec) => isInsideOrEqual(spec, contentRoot)),
    issues
  };
}

export function findMatchingSpecForFile(filePath: string): MatchResult {
  const directory = path.dirname(filePath);
  const parsed = path.parse(filePath);
  const desiredName = `${parsed.name}.sdd`;
  return findCaseInsensitivePath(directory, desiredName);
}

export type MatchResult =
  | { kind: "found"; path: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; message: string };

function resolveVerticalDirectorySpecs(contentRoot: string, targetDirectory: string): Array<string | { message: string }> {
  const result: Array<string | { message: string }> = [];
  const root = path.resolve(contentRoot);
  const target = path.resolve(targetDirectory);

  if (!isInsideOrEqual(target, root)) {
    result.push({ message: `Target is outside content root: ${target}` });
    return result;
  }

  const directories = directoriesFromRoot(root, target);
  for (const directory of directories) {
    if (directory !== root) {
      const parentHeld = findParentHeldDirectorySpec(directory);
      pushMatch(result, parentHeld);
    }

    const local = findLocalDirectorySpec(directory);
    pushMatch(result, local);
  }

  return result;
}

function findLocalDirectorySpec(directory: string): MatchResult {
  return findCaseInsensitivePath(directory, `${path.basename(directory)}.sdd`);
}

function findParentHeldDirectorySpec(directory: string): MatchResult {
  const parent = path.dirname(directory);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return { kind: "missing" };
  }
  return findCaseInsensitivePath(parent, `${path.basename(directory)}.sdd`);
}

function findCaseInsensitivePath(directory: string, desiredName: string): MatchResult {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return { kind: "missing" };
  }

  const exact = path.join(directory, desiredName);
  if (fs.existsSync(exact)) {
    return {
      kind: "found",
      path: exact
    };
  }

  const lowerDesired = desiredName.toLowerCase();
  const matches = fs.readdirSync(directory).filter((entry) => entry.toLowerCase() === lowerDesired);
  if (matches.length === 1) {
    return {
      kind: "found",
      path: path.join(directory, matches[0]!)
    };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      message: `Ambiguous case-insensitive spec matches for '${desiredName}' in ${directory}.`
    };
  }

  return { kind: "missing" };
}

function pushMatch(target: Array<string | { message: string }>, match: MatchResult) {
  if (match.kind === "found") {
    target.push(match.path);
  } else if (match.kind === "ambiguous") {
    target.push({ message: match.message });
  }
}

function directoriesFromRoot(root: string, target: string): string[] {
  const directories = [root];
  const relative = path.relative(root, target);
  if (!relative) {
    return directories;
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

function discoverGitRoot(startDirectory: string): string | undefined {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const normalized = path.resolve(candidate);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function compileGlobPattern(pattern: string): { ok: true; matcher: RegExp } | { ok: false; issue: string } {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if ("*" === char && "*" === next) {
      const following = pattern[index + 2];
      if ("/" === following) {
        regex += "(?:.*\\/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if ("*" === char) {
      regex += "[^/]*";
      continue;
    }

    if ("?" === char) {
      regex += "[^/]";
      continue;
    }

    if ("[" === char) {
      const close = pattern.indexOf("]", index + 1);
      if (close <= index + 1) {
        return {
          ok: false,
          issue: "Glob pattern has an unmatched or empty character class bracket."
        };
      }

      const content = pattern.slice(index + 1, close);
      if (content.includes("/")) {
        return {
          ok: false,
          issue: "Glob character classes cannot include path separators."
        };
      }

      regex += `[${escapeCharacterClass(content)}]`;
      index = close;
      continue;
    }

    if ("]" === char) {
      return {
        ok: false,
        issue: "Glob pattern has an unmatched character class bracket."
      };
    }

    if ("{" === char) {
      const close = pattern.indexOf("}", index + 1);
      if (close <= index + 1) {
        return {
          ok: false,
          issue: "Glob pattern has an unmatched or empty alternatives brace."
        };
      }

      const alternatives = pattern.slice(index + 1, close).split(",");
      if (alternatives.some((alternative) => alternative.length === 0)) {
        return {
          ok: false,
          issue: "Glob alternatives cannot contain empty choices."
        };
      }

      regex += `(?:${alternatives.map(escapeRegExp).join("|")})`;
      index = close;
      continue;
    }

    if ("}" === char) {
      return {
        ok: false,
        issue: "Glob pattern has an unmatched alternatives brace."
      };
    }

    regex += escapeRegExp(char ?? "");
  }

  return {
    ok: true,
    matcher: new RegExp(`^${regex}$`)
  };
}

function globSearchRoot(absolutePattern: string, contentRoot: string): string {
  const normalizedPattern = path.resolve(absolutePattern);
  const firstGlobIndex = findFirstGlobMetaIndex(normalizedPattern);
  if (firstGlobIndex === -1) {
    return path.dirname(normalizedPattern);
  }

  const staticPrefix = normalizedPattern.slice(0, firstGlobIndex);
  const candidate = staticPrefix.endsWith(path.sep)
    ? staticPrefix
    : path.dirname(staticPrefix);
  const resolvedCandidate = path.resolve(candidate || path.parse(normalizedPattern).root);
  return isInsideOrEqual(resolvedCandidate, contentRoot)
    ? resolvedCandidate
    : path.resolve(contentRoot);
}

function findFirstGlobMetaIndex(value: string): number {
  const indexes = ["*", "?", "[", "{"]
    .map((char) => value.indexOf(char))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function findMatches(searchRoot: string, matcher: RegExp, maxMatches: number): string[] {
  const matches: string[] = [];
  const visit = (directory: string) => {
    if (matches.length >= maxMatches) {
      return;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches || ".git" === entry || "dist" === entry || "node_modules" === entry) {
        continue;
      }

      const absolute = path.join(directory, entry);
      const normalized = toPosixPath(absolute);
      if (matcher.test(normalized)) {
        matches.push(absolute);
      }

      try {
        if (fs.statSync(absolute).isDirectory()) {
          visit(absolute);
        }
      } catch {
        continue;
      }
    }
  };

  visit(searchRoot);
  return matches.sort((left, right) => left.localeCompare(right));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCharacterClass(value: string): string {
  return value.replace(/[\\\]^-]/g, "\\$&");
}
