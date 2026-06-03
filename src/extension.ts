import * as path from "node:path";
import * as vscode from "vscode";
import {
  BODYLESS_SECTIONS,
  SCENARIO_KEYWORDS,
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  SDD_LANGUAGE_ID,
  TASK_MARKER_LABELS,
  TASK_MARKERS,
  type SectionLabel
} from "./language.js";
import {
  type ParsedSddDocument,
  type Range as SddRange,
  type SddDiagnostic,
  type SddReference,
  parseSddDocument
} from "./parser.js";
import {
  findMatchingSpecForFile,
  resolveContentRoot,
  resolveDocumentLinkTarget,
  resolveGlobReference,
  resolveRelatedSpecsForTarget,
  validatePathReferences
} from "./references.js";

let diagnostics: vscode.DiagnosticCollection;

const selector: vscode.DocumentSelector = [
  { language: SDD_LANGUAGE_ID, scheme: "file" },
  { language: SDD_LANGUAGE_ID, scheme: "untitled" }
];

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection("specdd");
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument(updateDiagnostics),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("specdd")) {
        refreshOpenDiagnostics();
      }
    }),
    vscode.languages.registerCompletionItemProvider(selector, new SddCompletionProvider(), " ", "["),
    vscode.languages.registerDocumentSymbolProvider(selector, new SddDocumentSymbolProvider()),
    vscode.languages.registerFoldingRangeProvider(selector, new SddFoldingRangeProvider()),
    vscode.languages.registerHoverProvider(selector, new SddHoverProvider()),
    vscode.languages.registerDocumentLinkProvider(selector, new SddDocumentLinkProvider()),
    vscode.commands.registerCommand("specdd.openRelatedSpec", openRelatedSpec),
    vscode.commands.registerCommand("specdd.createMatchingSpec", createMatchingSpec),
    vscode.commands.registerCommand("specdd.validateWorkspace", validateWorkspace),
    vscode.commands.registerCommand("specdd.showContentRoot", showContentRoot),
    vscode.commands.registerCommand("specdd.openGlobReference", openGlobReference)
  );

  refreshOpenDiagnostics();
}

export function deactivate() {
  diagnostics?.dispose();
}

class SddCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    const parsed = parseSddDocument(document.getText());
    const section = sectionAtLine(parsed, position.line);

    if (/^\s*$/.test(prefix)) {
      if (section?.label === "Tasks" && prefix.length <= 2) {
        return taskMarkerCompletions();
      }
      if (section?.label === "Scenario" && prefix.length <= 2) {
        return scenarioStepCompletions();
      }
      if (prefix.length === 0) {
        return sectionCompletions();
      }
    }

    if (section?.label === "Tasks" && /^\s{2}\[?$/.test(prefix)) {
      return taskMarkerCompletions();
    }

    if (section?.label === "Scenario" && /^\s{2}[A-Za-z]*$/.test(prefix)) {
      return scenarioStepCompletions();
    }

    return [];
  }
}

class SddDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const parsed = parseSddDocument(document.getText());
    return parsed.sections.map((section) => {
      const symbol = new vscode.DocumentSymbol(
        section.inlineValue ? `${section.label}: ${section.inlineValue}` : section.label,
        SECTION_DESCRIPTIONS[section.label],
        section.label === "Scenario" ? vscode.SymbolKind.Event : vscode.SymbolKind.Namespace,
        toDocumentRange(document, section.startLine, section.endLine),
        toVscodeRange(section.headerRange)
      );

      for (const entry of section.entries) {
        if (entry.kind === "task" && entry.task) {
          symbol.children.push(
            new vscode.DocumentSymbol(
              `${entry.task.marker} ${entry.task.id ? `${entry.task.id} ` : ""}${entry.task.text}`.trim(),
              entry.task.state,
              vscode.SymbolKind.Boolean,
              toDocumentRange(document, entry.line, lastEntryLine(entry)),
              toVscodeRange(entry.range)
            )
          );
        } else if (entry.kind === "scenario-step" && entry.scenarioStep) {
          symbol.children.push(
            new vscode.DocumentSymbol(
              `${entry.scenarioStep.keyword} ${entry.scenarioStep.text}`.trim(),
              "scenario step",
              vscode.SymbolKind.String,
              toDocumentRange(document, entry.line, lastEntryLine(entry)),
              toVscodeRange(entry.range)
            )
          );
        }
      }

      return symbol;
    });
  }
}

class SddFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const parsed = parseSddDocument(document.getText());
    return parsed.sections
      .filter((section) => section.endLine > section.startLine)
      .map((section) => new vscode.FoldingRange(section.startLine, section.endLine, vscode.FoldingRangeKind.Region));
  }
}

class SddHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const parsed = parseSddDocument(document.getText());
    const section = parsed.sections.find((candidate) => candidate.startLine === position.line);
    if (section && position.character <= section.label.length) {
      return new vscode.Hover(new vscode.MarkdownString(`**${section.label}**\n\n${SECTION_DESCRIPTIONS[section.label]}`));
    }

    const line = document.lineAt(position.line).text;
    const marker = line.slice(2, 5);
    if (line.startsWith("  ") && marker in TASK_MARKER_LABELS && position.character >= 2 && position.character <= 5) {
      const state = TASK_MARKER_LABELS[marker as keyof typeof TASK_MARKER_LABELS];
      return new vscode.Hover(new vscode.MarkdownString(`**Task:** ${state}`));
    }

    const reference = parsed.references.find((candidate) => containsPosition(candidate.range, position));
    if (reference?.kind === "path") {
      return new vscode.Hover(new vscode.MarkdownString(`**SpecDD path**\n\n\`${reference.value}\``));
    }
    if (reference?.kind === "symbol") {
      return new vscode.Hover(new vscode.MarkdownString(`**SpecDD symbol reference**\n\n\`${reference.value}\``));
    }

    return undefined;
  }
}

class SddDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (document.uri.scheme !== "file") {
      return [];
    }

    const parsed = parseSddDocument(document.getText());
    const contentRoot = contentRootForUri(document.uri);
    const maxGlobResults = vscode.workspace
      .getConfiguration("specdd", document.uri)
      .get<number>("references.maxGlobResults", 250);
    const links: vscode.DocumentLink[] = [];

    for (const reference of parsed.references) {
      if (reference.kind === "path" && reference.isGlob) {
        const globLink = createGlobDocumentLink(reference, document.uri.fsPath, contentRoot, maxGlobResults);
        if (globLink) {
          links.push(globLink);
        }
        continue;
      }

      const target = resolveDocumentLinkTarget(reference, document.uri.fsPath, contentRoot);
      if (target) {
        links.push(new vscode.DocumentLink(toVscodeRange(reference.range), vscode.Uri.file(target)));
      }
    }

    return links;
  }
}

function updateDiagnostics(document: vscode.TextDocument) {
  if (document.languageId !== SDD_LANGUAGE_ID) {
    return;
  }

  if (!vscode.workspace.getConfiguration("specdd", document.uri).get<boolean>("diagnostics.enabled", true)) {
    diagnostics.delete(document.uri);
    return;
  }

  const parsed = parseSddDocument(document.getText());
  const allDiagnostics = [...parsed.diagnostics];

  if (
    document.uri.scheme === "file" &&
    vscode.workspace.getConfiguration("specdd", document.uri).get<boolean>("references.validate", true)
  ) {
    const contentRoot = contentRootForUri(document.uri);
    const maxGlobResults = vscode.workspace
      .getConfiguration("specdd", document.uri)
      .get<number>("references.maxGlobResults", 250);
    allDiagnostics.push(...validatePathReferences(parsed, document.uri.fsPath, contentRoot, maxGlobResults));
  }

  diagnostics.set(document.uri, allDiagnostics.map(toVscodeDiagnostic));
}

function refreshOpenDiagnostics() {
  for (const document of vscode.workspace.textDocuments) {
    updateDiagnostics(document);
  }
}

async function openRelatedSpec() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showInformationMessage("Open a file-backed document to resolve related SpecDD specs.");
    return;
  }

  const contentRoot = contentRootForUri(editor.document.uri);
  const result = resolveRelatedSpecsForTarget(editor.document.uri.fsPath, contentRoot);
  if (result.issues.length > 0) {
    vscode.window.showWarningMessage(result.issues.join("\n"));
  }
  if (result.specs.length === 0) {
    vscode.window.showInformationMessage("No related SpecDD specs found.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    result.specs.map((specPath) => ({
      label: path.relative(contentRoot, specPath) || path.basename(specPath),
      description: specPath,
      specPath
    })),
    { placeHolder: "Open related SpecDD spec" }
  );

  if (picked) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.specPath));
    await vscode.window.showTextDocument(document);
  }
}

async function createMatchingSpec() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showInformationMessage("Open a file-backed source document to create a matching SpecDD spec.");
    return;
  }

  const filePath = editor.document.uri.fsPath;
  if (filePath.toLowerCase().endsWith(".sdd")) {
    vscode.window.showInformationMessage("The active document is already a SpecDD spec.");
    return;
  }

  const match = findMatchingSpecForFile(filePath);
  if (match.kind === "found") {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(match.path));
    await vscode.window.showTextDocument(document);
    return;
  }
  if (match.kind === "ambiguous") {
    vscode.window.showWarningMessage(match.message);
    return;
  }

  const parsed = path.parse(filePath);
  const specPath = path.join(parsed.dir, `${parsed.name}.sdd`);
  const subject = titleFromBasename(parsed.name);
  const content = `Spec: ${subject}\n\nPurpose:\n  Describe ${subject}.\n`;
  await vscode.workspace.fs.writeFile(vscode.Uri.file(specPath), Buffer.from(content, "utf8"));
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(specPath));
  await vscode.window.showTextDocument(document);
}

async function validateWorkspace() {
  const files = await vscode.workspace.findFiles("**/*.sdd", "{**/node_modules/**,**/.git/**,**/dist/**}");
  let diagnosticCount = 0;

  for (const uri of files) {
    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    const document = openDocument ?? (await vscode.workspace.openTextDocument(uri));
    updateDiagnostics(document);
    diagnosticCount += diagnostics.get(uri)?.length ?? 0;
  }

  vscode.window.showInformationMessage(
    `Validated ${files.length} SpecDD file${files.length === 1 ? "" : "s"} with ${diagnosticCount} diagnostic${diagnosticCount === 1 ? "" : "s"}.`
  );
}

function showContentRoot() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showInformationMessage("Open a file-backed SpecDD document to show its content root.");
    return;
  }

  vscode.window.showInformationMessage(`SpecDD content root: ${contentRootForUri(editor.document.uri)}`);
}

interface OpenGlobReferenceArgs {
  reference: SddReference;
  currentSpecPath: string;
  contentRoot: string;
  maxGlobResults: number;
}

function createGlobDocumentLink(
  reference: SddReference,
  currentSpecPath: string,
  contentRoot: string,
  maxGlobResults: number
): vscode.DocumentLink | undefined {
  const resolved = resolveGlobReference(reference, currentSpecPath, contentRoot, maxGlobResults);
  if (!resolved?.insideContentRoot || resolved.matches.length === 0) {
    return undefined;
  }

  if (resolved.issue && resolved.issue.code !== "glob-result-limit") {
    return undefined;
  }

  if (resolved.matches.length === 1) {
    const link = new vscode.DocumentLink(toVscodeRange(reference.range), vscode.Uri.file(resolved.matches[0]!));
    link.tooltip = "Open matching path";
    return link;
  }

  const args: OpenGlobReferenceArgs = {
    reference,
    currentSpecPath,
    contentRoot,
    maxGlobResults
  };
  const commandUri = vscode.Uri.parse(
    `command:specdd.openGlobReference?${encodeURIComponent(JSON.stringify([args]))}`
  );
  const link = new vscode.DocumentLink(toVscodeRange(reference.range), commandUri);
  link.tooltip = `Choose from ${resolved.matches.length} matching paths`;
  return link;
}

async function openGlobReference(args: OpenGlobReferenceArgs | undefined) {
  if (!isOpenGlobReferenceArgs(args)) {
    vscode.window.showWarningMessage("Cannot open SpecDD glob reference: invalid link arguments.");
    return;
  }

  const resolved = resolveGlobReference(args.reference, args.currentSpecPath, args.contentRoot, args.maxGlobResults);
  if (!resolved?.insideContentRoot) {
    vscode.window.showWarningMessage("Glob reference resolves outside the SpecDD content root.");
    return;
  }
  if (resolved.issue && resolved.issue.code !== "glob-result-limit") {
    vscode.window.showWarningMessage(resolved.issue.message);
    return;
  }
  if (resolved.matches.length === 0) {
    vscode.window.showInformationMessage("Glob reference does not match any existing files or directories.");
    return;
  }
  if (resolved.issue?.code === "glob-result-limit") {
    vscode.window.showWarningMessage(resolved.issue.message);
  }

  const picked = resolved.matches.length === 1
    ? { targetPath: resolved.matches[0]! }
    : await vscode.window.showQuickPick(
        resolved.matches.map((targetPath) => ({
          label: path.relative(args.contentRoot, targetPath) || path.basename(targetPath),
          description: targetPath,
          targetPath
        })),
        { placeHolder: `Open match for ${args.reference.value}` }
      );

  if (picked) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.targetPath));
    await vscode.window.showTextDocument(document);
  }
}

function isOpenGlobReferenceArgs(value: unknown): value is OpenGlobReferenceArgs {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<OpenGlobReferenceArgs>;
  return (
    typeof candidate.currentSpecPath === "string" &&
    typeof candidate.contentRoot === "string" &&
    typeof candidate.maxGlobResults === "number" &&
    !!candidate.reference &&
    typeof candidate.reference === "object" &&
    (candidate.reference as Partial<SddReference>).kind === "path" &&
    typeof (candidate.reference as Partial<SddReference>).value === "string" &&
    (candidate.reference as Partial<SddReference>).isGlob === true
  );
}

function sectionCompletions(): vscode.CompletionItem[] {
  return SECTION_LABELS.map((label) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
    item.detail = SECTION_DESCRIPTIONS[label];
    item.insertText = snippetForSection(label);
    return item;
  });
}

function taskMarkerCompletions(): vscode.CompletionItem[] {
  return TASK_MARKERS.map((marker) => {
    const item = new vscode.CompletionItem(marker, vscode.CompletionItemKind.EnumMember);
    item.detail = TASK_MARKER_LABELS[marker];
    item.insertText = new vscode.SnippetString(`${marker} $0`);
    return item;
  });
}

function scenarioStepCompletions(): vscode.CompletionItem[] {
  return SCENARIO_KEYWORDS.map((keyword) => {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.insertText = new vscode.SnippetString(`${keyword} $0`);
    return item;
  });
}

function snippetForSection(label: SectionLabel): vscode.SnippetString {
  if (label === "Spec") {
    return new vscode.SnippetString("Spec: ${1:Subject}");
  }
  if (label === "Platform") {
    return new vscode.SnippetString("Platform: ${1:Platform}");
  }
  if (label === "Scenario") {
    return new vscode.SnippetString("Scenario: ${1:name}\n  $0");
  }
  if (label === "Example") {
    return new vscode.SnippetString("Example: ${1:name}\n  $0");
  }
  if (BODYLESS_SECTIONS.has(label)) {
    return new vscode.SnippetString(`${label}:`);
  }
  return new vscode.SnippetString(`${label}:\n  $0`);
}

function sectionAtLine(parsed: ParsedSddDocument, line: number) {
  return parsed.sections.find((section) => line >= section.startLine && line <= section.endLine);
}

function contentRootForUri(uri: vscode.Uri): string {
  const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  const config = vscode.workspace.getConfiguration("specdd", uri);
  const configured = config.get<string | null>("contentRoot", null);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const configuredRoot =
    configured && configured.trim().length > 0 && !path.isAbsolute(configured) && workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, configured)
      : configured;

  return resolveContentRoot(uri.fsPath, workspaceFolders, configuredRoot);
}

function toVscodeDiagnostic(diagnostic: SddDiagnostic): vscode.Diagnostic {
  const result = new vscode.Diagnostic(toVscodeRange(diagnostic.range), diagnostic.message, toSeverity(diagnostic));
  result.code = diagnostic.code;
  result.source = "SpecDD";
  return result;
}

function toSeverity(diagnostic: SddDiagnostic): vscode.DiagnosticSeverity {
  if (diagnostic.severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  if (diagnostic.severity === "info") {
    return vscode.DiagnosticSeverity.Information;
  }
  return vscode.DiagnosticSeverity.Error;
}

function toVscodeRange(range: SddRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    Math.max(range.end.character, range.start.character + 1)
  );
}

function toDocumentRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const boundedEndLine = Math.min(Math.max(startLine, endLine), document.lineCount - 1);
  return new vscode.Range(startLine, 0, boundedEndLine, document.lineAt(boundedEndLine).text.length);
}

function containsPosition(range: SddRange, position: vscode.Position): boolean {
  return (
    position.line === range.start.line &&
    position.character >= range.start.character &&
    position.character <= range.end.character
  );
}

function lastEntryLine(entry: { line: number; continuations: Array<{ line: number }> }): number {
  return entry.continuations.length > 0 ? entry.continuations[entry.continuations.length - 1]!.line : entry.line;
}

function titleFromBasename(basename: string): string {
  return basename
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}
