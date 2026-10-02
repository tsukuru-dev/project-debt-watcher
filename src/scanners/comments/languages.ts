import { posix } from "node:path";

export type SourceLanguage = "python" | "javascript" | "jsx" | "typescript" | "tsx"
  | "css" | "c" | "cpp" | "rust" | "go" | "ruby" | "html" | "django-template" | "php";

// Candidate classification only; extractor support is implemented separately per language.
const extensions: Readonly<Record<string, SourceLanguage>> = {
  ".py": "python", ".pyi": "python", ".pyw": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".css": "css", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c++": "cpp",
  ".c": "c",
  ".h": "cpp", ".hh": "cpp", ".hpp": "cpp", ".hxx": "cpp",
  ".rs": "rust", ".go": "go",
  ".rb": "ruby", ".rake": "ruby", ".gemspec": "ruby",
  ".html": "html", ".htm": "html", ".djhtml": "django-template", ".django": "django-template",
  ".php": "php", ".phtml": "php",
};

export function languageForPath(path: string): SourceLanguage | undefined {
  if (["Gemfile", "Rakefile"].includes(posix.basename(path))) return "ruby";
  const extension = posix.extname(path);
  return extension === ".C" ? "cpp" : extensions[extension.toLowerCase()];
}
