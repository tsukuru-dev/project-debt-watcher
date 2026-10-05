import { listSourceFiles, readSourceFile, type CommittedSourceFile, type SourceRead } from "../../git/files.js";
import type { BranchSnapshot } from "../../git/branches.js";
import type { GitContext } from "../../git/client.js";
import { blameCommentFindings, type BlamedComment } from "../../git/blame.js";
import { validateMarkers } from "../../config/validate.js";
import { extractCComments } from "./c.js";
import { extractCssComments } from "./css.js";
import { extractDjangoTemplateComments } from "./django.js";
import { createGoCommentExtractor, type GoExtractorOptions } from "./go-tool.js";
import { extractHtmlComments } from "./html.js";
import { extractJavaScriptComments } from "./javascript.js";
import type { SourceLanguage } from "./languages.js";
import { matchCommentMarkers } from "./markers.js";
import { createPhpCommentExtractor, type PhpExtractorOptions } from "./php-tool.js";
import { createPythonCommentExtractor, type PythonExtractorOptions } from "./python-tool.js";
import { createRubyCommentExtractor, type RubyExtractorOptions } from "./ruby-tool.js";
import { extractRustComments } from "./rust.js";
import type { CommentExtraction, SourcePosition } from "./types.js";

export interface CommentScanOptions {
  python?: PythonExtractorOptions;
  ruby?: RubyExtractorOptions;
  go?: GoExtractorOptions;
  php?: PhpExtractorOptions;
}

export type CommentBackend = { kind: "official" | "builtin"; name: string; version: string;
  executable?: string; reason?: string };

export type ScannedCommentFile =
  | { file: CommittedSourceFile; status: "ok"; findings: BlamedComment[] }
  | { file: CommittedSourceFile; status: "skipped"; reason: Extract<SourceRead, { kind: "skipped" }>["reason"] }
  | { file: CommittedSourceFile; status: "invalid" | "unsupported";
    diagnostic: { message: string; position: SourcePosition } };

export interface BranchCommentScan {
  branch: BranchSnapshot;
  files: ScannedCommentFile[];
}

export interface CommentScanResult {
  branches: BranchCommentScan[];
  /** Backend chosen once per language actually extracted during this scan. */
  backends: Partial<Record<SourceLanguage, CommentBackend>>;
}

interface Session {
  backend: CommentBackend;
  extract(source: string): Promise<CommentExtraction>;
  close?(): Promise<void>;
}

/** Read immutable branch snapshots, match comments, and blame each marker line without inspecting the working tree. */
export async function scanCommittedComments(context: GitContext, branches: readonly BranchSnapshot[],
  markers: readonly string[], options: CommentScanOptions = {}): Promise<CommentScanResult> {
  validateMarkers(markers);
  const sessions = new Map<SourceLanguage, Session>();
  const backends: CommentScanResult["backends"] = {};
  const builtin = (name: string, extract: (source: string) => CommentExtraction): Session => ({
    backend: { kind: "builtin", name, version: "1" }, extract: async (source) => extract(source),
  });
  const sessionFor = async (language: SourceLanguage): Promise<Session> => {
    const existing = sessions.get(language);
    if (existing) return existing;
    let session: Session;
    switch (language) {
      case "python": session = await createPythonCommentExtractor(options.python); break;
      case "ruby": session = await createRubyCommentExtractor(options.ruby); break;
      case "go": session = await createGoCommentExtractor(options.go); break;
      case "php": session = await createPhpCommentExtractor(options.php); break;
      case "javascript": case "jsx": case "typescript": case "tsx":
        session = builtin("debt-finder-javascript", (source) => extractJavaScriptComments(source, language)); break;
      case "c": case "cpp":
        session = builtin("debt-finder-c", (source) => extractCComments(source, language)); break;
      case "css": session = builtin("debt-finder-css", extractCssComments); break;
      case "html": session = builtin("debt-finder-html", extractHtmlComments); break;
      case "django-template": session = builtin("debt-finder-django", extractDjangoTemplateComments); break;
      case "rust": session = builtin("debt-finder-rust", extractRustComments); break;
    }
    sessions.set(language, session);
    backends[language] = session.backend;
    return session;
  };

  try {
    const scanned: BranchCommentScan[] = [];
    for (const branch of branches) {
      const files: ScannedCommentFile[] = [];
      for (const file of await listSourceFiles(branch.commitId, context)) {
        const read = await readSourceFile(file, context);
        if (read.kind === "skipped") {
          files.push({ file, status: "skipped", reason: read.reason });
          continue;
        }
        const session = await sessionFor(file.language);
        const extraction = await session.extract(read.text);
        const marked = matchCommentMarkers(extraction, markers);
        if (marked.status === "ok") {
          files.push({ file, status: "ok",
            findings: await blameCommentFindings(context, branch, file, read.text, marked.findings) });
        }
        else files.push({ file, status: marked.status, diagnostic: marked.diagnostic });
      }
      scanned.push({ branch, files });
    }
    return { branches: scanned, backends };
  } finally {
    for (const session of sessions.values()) await session.close?.();
  }
}
