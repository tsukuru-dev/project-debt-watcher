import { posix } from "node:path";

export type SourceLanguage = "python" | "javascript" | "jsx" | "typescript" | "tsx"
  | "css" | "cpp" | "rust" | "go" | "django-template";

// Candidate classification only; extractor support is implemented separately per language.
const extensions: Readonly<Record<string, SourceLanguage>> = {
  ".py": "python", ".pyi": "python", ".pyw": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".css": "css", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c++": "cpp",
  ".h": "cpp", ".hh": "cpp", ".hpp": "cpp", ".hxx": "cpp",
  ".rs": "rust", ".go": "go",
  ".html": "django-template", ".htm": "django-template", ".djhtml": "django-template", ".django": "django-template",
};

export function languageForPath(path: string): SourceLanguage | undefined {
  const extension = posix.extname(path);
  return extension === ".C" ? "cpp" : extensions[extension.toLowerCase()];
}
