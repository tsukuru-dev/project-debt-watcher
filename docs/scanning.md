# Comment scanner: current implementation

Branch selection, committed source reads, initial extractors for every listed language family, official Python/Ruby/Go/PHP tool adapters, marker matching, and a committed-source scan pipeline with Git blame are implemented, with the scope and limitations below. The `graveyard` command uses this pipeline for code-only terminal reports.

`selectBranches` snapshots every named local branch by default. Remote scope snapshots existing remote-tracking branches from all remotes, excluding symbolic aliases such as `origin/HEAD`. Tags are excluded. An empty repository returns no branches. Detached HEAD does not add an unnamed branch to the set. Different branches pointing to the same commit remain separate snapshots.

Each snapshot records the full ref, display name, scope and commit ID. Later reads use that immutable commit rather than resolving the branch again. Moving or deleting a branch during a scan therefore does not change the saved source snapshot. Files come from commits, not the staging area or working directory. Untracked files and uncommitted edits are not included in this layer.

`listSourceFiles` enumerates regular tracked blobs throughout the commit tree, including executable source files. Symlinks and submodules are excluded. No implicit folder exclusions are applied: tracked source in a vendor/generated directory remains a candidate. Candidate extensions cover Python, Ruby, JavaScript/Node, JSX, TypeScript, TSX, CSS, C/C++ and headers, Rust, Go, PHP, and HTML/Django templates. Classification selects a language-specific extractor; unsupported syntax within those languages remains explicit.

Filenames are preserved using Git's NUL-delimited tree output. Blob reads use full object IDs, so spaces, tabs, newlines, colons or shell characters in filenames are never interpreted as shell commands or revision expressions. The same APIs support SHA-1 and SHA-256 object IDs. Reads work from nested directories and linked worktrees without changing the checkout or index.

Source reads return either text or an explicit skip reason. The initial per-file limit is 8 MiB; larger files are marked `too-large`. Files containing NUL bytes are marked `binary`, and invalid UTF-8 is marked `invalid-utf8`. Empty files are valid text. UTF-8 BOMs and line endings are preserved for later line/offset tracking. Callers can supply a different byte limit; this is an internal API parameter, not a new configuration setting or CLI option. Future reporting must expose skipped-file diagnostics rather than silently treating them as files with no debt.

Branch listings and tree listings have bounded output buffers (8 MiB and 32 MiB respectively). Exceeding these bounds fails instead of returning truncated results. Invalid filenames that cannot be decoded as UTF-8, invalid object IDs, missing objects and Git errors also fail explicitly.

These reads require Git 2.45 or newer for `--no-lazy-fetch`. They do not fetch refs or missing objects, run text-conversion filters, or apply Git replacement objects. Partial clones with missing objects must be prepared through the user's normal Git workflow before scanning.

## Language-specific comment syntax

Markers remain plain text such as `TODO` or `FIXME`. The language extractor determines which text is actually inside a comment before marker matching happens. These extractors identify comment boundaries and avoid comment-looking text in strings or other non-comment contexts; they do not aim to validate complete language grammars.

| Language | Comment syntax | Status |
| --- | --- | --- |
| JavaScript / TypeScript / Node | `// ...`, `/* ... */`, including JSDoc | Initial lexer implemented, with limitations below |
| JSX / TSX / React | JS comments in expressions, including `{/* ... */}`; plain JSX text is not a comment | Initial built-in lexer implemented, with limitations below |
| Python | `# ...`, including comments inside f/t-string expressions; literal text and docstrings are not comments | Official tokenizer adapter plus built-in lexer; 168 focused Python tests passed |
| Ruby | `# ...`, column-one `=begin` / `=end` blocks | Ripper adapter plus limited built-in fallback; real-Ruby verification pending in the current environment |
| C/C++ and headers | `// ...`, `/* ... */` | Initial built-in lexer implemented; see scope below |
| Rust | `// ...`, `/* ... */`, including nested blocks and doc comments | Built-in lexer implemented; focused tests passed |
| Go | `// ...`, non-nesting `/* ... */` | Official `go/scanner` adapter plus built-in lexer; focused tests passed, real-Go check skipped |
| CSS | `/* ... */` | Implemented for plain CSS; see scope below |
| Plain HTML | `<!-- ... -->`; CSS in `<style>` and JavaScript in `<script>` | Initial embedded comment extraction implemented; see scope below |
| Django HTML templates | `{# ... #}`, `{% comment %} ... {% endcomment %}`, `<!-- ... -->`; CSS/JavaScript in plain style/script elements | Initial extractor implemented; see scope below |
| PHP with HTML | PHP `// ...`, `# ...`, `/* ... */`; HTML `<!-- ... -->` outside PHP tags | Official `token_get_all()` adapter plus limited built-in fallback; real-PHP check pending |

Ruby classification includes `.rb`, `.rake`, `.gemspec`, and exact filenames `Gemfile` and `Rakefile`. ERB templates are not covered. PHP classification includes `.php` and `.phtml`. `.c` is classified as C; `.h` remains classified with C++ headers because its language cannot be determined from the extension alone. All listed families have an initial extractor, with the documented limits below.

Plain `.html` and `.htm` files are classified as HTML; `.djhtml` and `.django` are classified as Django templates. A Django template stored as `.html` currently returns `unsupported` when the plain HTML extractor encounters `{#` or `{%`. The Django extractor exists separately, but choosing it for a `.html` file is not yet wired into orchestration.

## Shared extraction helpers

`source.ts` shares source-position lookup and comment-record construction. Each extractor supplies its newline rules and comment-body boundaries. String, escape and token rules remain language-specific. All extractors return the same `CommentExtraction` type, which the marker matcher accepts. Blame integration comes later.

`matchCommentMarkers(extraction, markers)` in `markers.ts` checks only comment bodies returned by an extractor. Configured markers are literal and case-sensitive; a match touching a letter, number or underscore on either side is excluded when that edge of the marker is a word character. Internal spaces and punctuation are preserved. Longer overlapping markers take precedence, then configuration order. One comment becomes one finding even if it contains several matches, with each accepted marker occurrence retaining its original UTF-16 source offsets. An empty marker list yields no findings. Invalid or unsupported extraction passes through its diagnostic with no partial findings.

`scanCommittedComments(context, branches, markers, options)` in `scan.ts` joins branch snapshots, committed source reads, language selection, marker matching and Git blame. It creates each required extractor once per scan, prefers a compatible existing official tool where an adapter exists, records the selected backend, and closes the Go helper on completion or failure. Built-in mode can be selected per official-tool language for reproducible checks. Every candidate file produces an `ok` result with its flagged comments, a `skipped` reason for unreadable source, or an `invalid`/`unsupported` diagnostic. Only committed blobs are read; a dirty working tree is untouched. Integration tests cover all listed language families and multiple branch snapshots. The pipeline is not yet called by `graveyard`.

`blameCommentFindings` in `git/blame.ts` attributes each marker occurrence to its line in the exact branch commit used for extraction. A multiline comment can therefore carry different authors and authored dates on different marker lines. It reads Git's line-porcelain output without changing the checkout, caches repeated marker lines within a file, and retains author name, email, commit ID, summary and an ISO authored timestamp even when report display will hide authors. Git LF line boundaries determine blame line numbers. A Git or metadata failure stops the scan rather than fabricating an author or age. Focused integration tests cover separate line authors, repeated markers on one line, and dirty working-tree isolation.

`markup.ts` contains the HTML and Django-aware parsing shared by the two template extractors. `html.ts` selects plain HTML behavior; `django.ts` selects Django template behavior.

## Plain HTML extraction

`extractHtmlComments(source)` extracts `<!-- ... -->` comments from plain HTML while preserving original text and UTF-16 positions. It skips quoted tag attributes and text-only elements such as `<title>` and `<textarea>`, where a comment-looking sequence is text. It scans CSS in `<style>` and JavaScript in `<script>` using the corresponding comment extractors, mapping all comment positions back to the original HTML source. Common `type` attributes select CSS or JavaScript; known JSON/data script types are inert and skipped. Unknown embedded types, `<noscript>` content, Django delimiters, PHP processing tags, and unsupported declarations return `unsupported`. Malformed comments, tags or embedded content return `invalid`. A failure discards all partial comments. It does not render or execute HTML or templates, and it is not yet wired into reports.

## Django template extraction

`extractDjangoTemplateComments(source)` uses the same HTML context rules and also recognises single-line `{# ... #}` comments and `{% comment %} ... {% endcomment %}` blocks. It skips ordinary `{% ... %}` and `{{ ... }}` tokens, including those inside HTML attributes, so their contents cannot be mistaken for HTML syntax. Template and HTML comments retain original source positions and are returned in source order. Content inside a Django comment block is one comment, even if it contains broken template tags, other comment-looking text or HTML comment delimiters.

This first chunk rejects multiline `{# ... #}` comments, nested or unmatched `{% comment %}` tags, and opening comment tags with an optional note. The latter is valid Django syntax but is `unsupported` until its note can be represented without dropping markers. Plain CSS and JavaScript inside style/script elements are scanned; Django tokens within those elements remain `unsupported`, as are Django tokens inside other raw-text elements. Malformed tokens are `invalid`. Failures return no partial comments. No Django package is imported, no template is rendered, and this extractor is not yet wired into reports.

## PHP fallback extraction

`extractPhpComments(source)` recognises `<?php ... ?>` and `<?= ... ?>` regions without running the code. Inside PHP it extracts `//`, `#`, and non-nesting `/* ... */` comments, skips quoted strings, and treats PHP 8 `#[...]` attributes as code rather than hash comments. PHP line comments end at a newline or at `?>`, whichever comes first. Outside PHP, it delegates to the plain HTML extractor. Original text and positions are preserved across PHP and HTML regions, and comments are returned in source order. A PHP region overlapping an HTML comment is `unsupported` until mixed-language overlap semantics are defined.

This is a deliberately bounded fallback. Short `<?` tags depend on PHP settings and are `unsupported`, as are heredoc, nowdoc, backticks and complex string interpolation. HTML outside PHP delegates to the HTML extractor, including its script/style handling when the embedded content is wholly outside PHP. Unterminated strings and block comments are `invalid`. All failure results have no partial comments. The extractor is not yet wired into reports.

### Official PHP tokenizer

`createPhpCommentExtractor(options)` selects an existing compatible PHP CLI before the fallback. The fixed helper passes source text to PHP's [token_get_all()](https://www.php.net/manual/en/function.token-get-all.php) with `TOKEN_PARSE`; scanned source is never executed. `T_COMMENT` and `T_DOC_COMMENT` identify PHP comments, while `T_INLINE_HTML` identifies regions outside PHP tags. The adapter maps UTF-8 byte spans back to the original UTF-16 offsets and passes inline regions to the HTML extractor. HTML comments spanning PHP regions return `unsupported` rather than partial results. PHP parse errors return `invalid` with no partial comments.

Automatic selection checks existing `php` executables (`php.exe` on Windows) in absolute PATH directories, skipping relative paths and Windows Store aliases. It accepts stable PHP 8.x only after a capability probe checks mixed HTML, line/block comments and a nowdoc. Internal `mode: "auto"`, `"official"`, or `"builtin"` and an absolute `executable` path mirror the other language adapters; these are not CLI flags yet. Unavailable or incompatible PHP selects the labelled fallback in auto mode. A failure after official selection does not silently switch backends.

The helper runs through PHP CLI `-n -r` without loading `php.ini`, from the interpreter's directory and without a shell. PHP environment overrides are removed. The scanned project is never included, built or run. Input is limited to 8 MiB; each helper has a 10-second timeout and 32 MiB output limit. PHP is not on PATH in the current development environment, so real-interpreter verification is pending; mock and optional real-PHP tests have been added but not run at the user's request. No PHP installation or npm dependency was added.

## JavaScript and TypeScript extraction

`extractJavaScriptComments(source, language)` is a dependency-free lexer. It recognises line and block comments, skips quoted strings and supported regex literals, and enters `${...}` template expressions while leaving template text untouched. It preserves comment order, raw text, delimiter-free bodies, and positions for both. Positions use zero-based UTF-16 offsets, one-based lines/columns, and exclusive ends. Whitespace, JSDoc stars, UTF-8 BOMs, CRLF and Unicode line separators are retained in the original source representation.

Successful extraction returns `status: "ok"` and the comments, including comments without debt markers. This is not a JavaScript/TypeScript compiler or complete grammar validator. Unterminated strings/comments/regexes/templates and unbalanced delimiters produce `status: "invalid"`. Syntax requiring an unimplemented rule produces `status: "unsupported"`. Both return a position and diagnostic with no partial comments. Future reporting must surface these diagnostics rather than report the file as debt-free.

The JSX/TSX fallback now handles ordinary elements, fragments, nested elements, quoted attributes and JavaScript expression containers, including `{/* ... */}`. Comment-looking text in children or quoted attributes is ignored. Unsupported tag or attribute syntax returns a diagnostic with no partial results. This is an initial lexical subset, not full JSX/TSX grammar validation.

The lexer deliberately leaves decorators, escaped identifiers, legacy HTML-style JS comments, Unicode-set regexes and nested/literal opening brackets in regex classes unsupported. It also stops at uncertain regex-versus-division contexts, such as immediately after a closing brace, `await`/`yield`, ambiguous `>`/postfix `!`, or a TypeScript operand followed by a newline and slash. TypeScript angle-bracket assertions and generic arrows need a later rule. These restrictions can reject valid code; they must not silently trigger a plain-text marker search. Nested templates and JSX elements have a limit of 128 levels.

An optional official TypeScript parser remains under investigation. This project's TypeScript build dependency is 7.0.2, and the [TypeScript 7.0 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) state that 7.0 does not ship a stable programmatic API. The installed package exposes only `unstable` parser entry points. We therefore do not use those entry points for comment extraction or add TypeScript 6 as a new runtime dependency without discussing that packaging choice. The built-in scanner covers the JSX/TSX subset above.

No Git calls, file writes, source execution, module imports from scanned code or project configuration loading occur during extraction. Tests separately check the lexer and its use with committed-source reads. It is not yet wired into the report command.

## C/C++ extraction

`extractCComments(source, language)` handles `.c` as C and the existing C++ extensions and headers as C++. It extracts `//` and non-nesting `/* ... */` comments, skipping ordinary quoted and character literals. C++ raw strings, including encoded prefixes and custom delimiters, are skipped so comment-looking text inside them is not reported. Standard direct `#include <...>` and `#include "..."` header names are skipped. Comment-like text inside a header name is reported as `unsupported` because its interpretation can depend on the implementation. Original text and UTF-16 positions are preserved.

This first fallback does not run a preprocessor or compiler. Line splicing and trigraphs, macro-based or otherwise complex `#include` forms, `__has_include`, C++ header imports, and malformed raw strings return diagnostics without partial comments. Files with these forms are not treated as debt-free. An optional Clang integration remains a separate later decision because Clang tooling needs the installed toolchain and often project compile flags. C/C++ extractor tests have been added but not run at the user's request; the extractor is not yet wired into reports.

## CSS extraction

`extractCssComments(source)` extracts non-nesting `/* ... */` comments from plain CSS. Quoted strings and unquoted URL tokens are skipped; `//` is not a CSS comment. Escapes, escaped/case-insensitive `url` names, and surrounding token boundaries follow the [CSS Syntax tokenization rules](https://www.w3.org/TR/css-syntax-3/#tokenization).

Original text and UTF-16 offsets are retained. CSS line counting recognises CRLF, CR, LF and form feed; Unicode separators U+2028/U+2029 are not CSS newlines. CSS character replacement is applied only during token recognition, never to returned source text.

Malformed strings, escapes, URLs or unterminated comments return `invalid` with a position and no partial comments. This is deliberately stricter than browser error recovery. It is a comment lexer, not a declaration validator; it does not validate properties, nesting or balanced braces. SCSS, Sass and Less remain outside this extractor's scope. HTML style elements now delegate to this extractor. It never fetches URLs, follows imports or executes source.

## Python extraction

`createPythonCommentExtractor(options)` is the asynchronous official-tool-first entry point. The committed-source scanner creates it once per scan and calls `extract(source)` for each committed Python source. The returned `backend` records the name, version, executable for official extraction, or the fallback reason. `graveyard` uses this scanner.

Automatic selection searches absolute PATH directories for existing `python3`/`python` executables (with `.exe` on Windows), preserving PATH order. It skips relative entries, Windows Store aliases and `py` installation launchers. Only Python 3.12-3.14 passing a tokenizer capability probe is selected; older/newer or unavailable installations use the fallback. The upper bound is deliberate until newer versions are checked. A failed probe is recorded in the fallback reason. No runtime is downloaded or installed.

Internal options support `mode: "auto"` (default), `"official"` (fail if no suitable tool), or `"builtin"` (no discovery or subprocess). `executable` selects an absolute existing interpreter path with auto/official mode. These are internal API controls, not new CLI flags or configuration keys yet.

The fixed helper uses Python's [standard-library tokenizer](https://docs.python.org/3/library/tokenize.html), after syntax validation with `ast.parse`. F-string expression comments are supported; template strings require Python 3.14. Syntax newer than the selected interpreter understands is a source diagnostic, not a reason to switch scanners. Positions are mapped from Python code-point columns to our original UTF-16 offsets, preserving BOM and CRLF/CR/LF source text. Non-UTF-8 encoding declarations remain unsupported.

The helper receives JSON source via stdin and runs with `-I -S -B`: isolated imports, no site startup hooks and no bytecode writes. It runs from the interpreter's directory, with Python environment overrides removed, without a shell. It does not execute source statements or load project modules. Source is limited to 8 MiB; each subprocess has a 10-second timeout and 32 MiB output limit. Syntax errors return diagnostics with no partial comments. Process failures, malformed responses and version changes throw explicit extraction errors without fallback. Python's grammar validation is stricter than our built-in lexer's checks, so the two backends can reject different files.

### Built-in fallback

`extractPythonComments(source)` recognises UTF-8 Python 3 `#` comments, including shebangs, encoding cookies and type comments. It skips ordinary, raw, bytes and triple-quoted strings/docstrings, with case-insensitive `r`, `u`, `b`, `br` and `rb` prefixes. Text and UTF-16 positions remain unchanged; CRLF, CR and LF end lines, while form feed and Unicode separators do not. The fallback backend version is now `2`, distinguishing this expanded implementation in future report metadata.

F-strings and Python 3.14 template strings use expression-aware extraction, including `f`, `fr`, `rf`, `t`, `tr` and `rt` prefixes in any case and either short or triple quotes. The lexical model follows Python's [f-string and template-string rules](https://docs.python.org/3.14/reference/lexical_analysis.html#f-strings). It handles nested interpolation, reused quote styles, expression comments, escaped braces, raw escapes, named Unicode escapes, debug fields, conversions and nested format fields. Hashes in literal text and format-specifier text remain hidden; hashes in replacement expressions start real comments, including after nested strings or within bracketed expressions. A backslash before a brace does not suppress interpolation.

Unterminated strings/fields, mismatched expression brackets, empty fields, invalid conversions, single literal closing braces, invalid line-joining backslashes and NUL characters return `invalid` with a position and no partial results. Interpolation scanner depth and expression bracket depth are each bounded at 128; exceeding either returns `unsupported`. Python 2 backticks and active non-UTF-8 encoding declarations remain unsupported under the existing source-reading policy.

This lexer does not validate indentation, the full expression grammar, Unicode character names, all escape values or bytes-literal contents. It targets modern Python 3 lexical syntax rather than enforcing the grammar of a particular installed interpreter; for example, the fallback accepts t-strings even where the selected official Python 3.12/3.13 backend would reject them. Neither path executes scanned source. The official adapter still performs full syntax validation with `ast.parse`.

Fallback cases cover interpolation boundaries, positions, malformed input and nesting limits, with a shared corpus for comparisons against an available official Python installation. Blame and code-only report integration now use the extracted comments.

## Ruby extraction

`createRubyCommentExtractor(options)` selects a backend once per scan and exposes `extract(source)` plus backend name/version and either an executable path or fallback reason. Internal options mirror Python: `mode: "auto"`, `"official"`, or `"builtin"`, and an optional absolute `executable` path. These controls are not CLI flags or configuration keys yet.

Automatic selection checks existing `ruby` executables (`ruby.exe` on Windows) in absolute PATH directories, skipping relative directories and Windows Store aliases. The initial version gate accepts Ruby 3.1-3.4 only after a capability probe checks line comments, block comments, Unicode positions and interpolation comments. Other versions, missing tools or failed probes use the limited fallback in auto mode; official mode fails explicitly. No Ruby installation is performed.

The fixed helper uses Ruby's official [Ripper lexer](https://docs.ruby-lang.org/en/3.4/Ripper.html), with `raise_errors: true`. It sends comment byte spans back to Node, which validates boundaries and maps them to the original UTF-16 offsets. A leading UTF-8 BOM is removed only from the helper input; returned positions still refer to the original source. CRLF is preserved. Ripper handles Ruby literal forms such as regexes, percent literals, heredocs and interpolated expressions; their contents must not be mistaken for comments.

Source travels as JSON through stdin, never as executable Ruby. The subprocess runs without a shell from the interpreter's directory, disables RubyGems and did_you_mean startup, and removes Ruby, gem and Bundler environment overrides. It does not execute `BEGIN` blocks, requires or other statements in scanned source. Inputs are limited to 8 MiB, subprocess time to 10 seconds, and output to 32 MiB. Extraction failures after selection never silently switch to the fallback. Syntax errors return no partial comments; their diagnostic currently points to the file start, with Ripper's error message retained.

Both backends reject non-UTF-8 encoding declarations, bare CR line endings and source-terminating control characters. Source discovery already requires UTF-8. These restrictions return an explicit `unsupported` diagnostic rather than silently losing source text.

### Built-in Ruby fallback

`extractRubyComments(source)` recognises hash comments, unindented `=begin` / `=end` blocks, ordinary single/double-quoted strings and the exact column-one `__END__` data marker. Block delimiters occupy their own lines and may have trailing labels; comment bodies exclude those delimiter lines. LF and CRLF are supported. See Ruby's [comment syntax](https://docs.ruby-lang.org/en/3.4/syntax/comments_rdoc.html).

The fallback deliberately rejects interpolation in double-quoted strings, control/meta escapes, regex/percent literals, heredocs, character literals, backticks and special global-variable syntax. Conservative token checks also reject division, modulo, shifts and method names containing `?`. Unsupported or malformed input returns a diagnostic and no partial comments; this is not a complete Ruby grammar validator.

Fallback, mocked adapter and committed-source tests run without Ruby. Integration tests additionally exercise a real Ripper installation when available, including checks that scanned statements and Ruby startup hooks are not executed. Those real-Ruby checks are skipped in the current development environment because Ruby is not on PATH; compatibility across the accepted Ruby versions remains to be verified on machines providing them.

## Go extraction

`extractGoComments(source)` is the built-in Go comment lexer. It recognises `//` and non-nesting `/* ... */` comments, skipping interpreted strings, backtick raw strings and rune literals. It validates literal escape lengths/ranges and single-rune contents, including Unicode code points. The lexical rules are based on the [Go specification](https://go.dev/ref/spec#Comments).

Original UTF-16 offsets and text are retained. LF increments the line number; bare CR remains part of the same physical line. A line comment excludes its CRLF terminator, but internal CRs and block-comment line endings remain unchanged. A leading BOM is preserved in offsets; embedded BOMs, NULs and unpaired surrogates return invalid-source diagnostics. Unterminated comments/literals and malformed escapes return no partial comments.

Directives such as `//line`, `//go:build` and `//go:generate`, generated-file notices and cgo preambles remain inert comment text. They do not remap positions, filter files or execute commands. This is a comment lexer, not a full grammar or numeric-literal validator.

`createGoCommentExtractor(options)` now selects the official [go/scanner](https://pkg.go.dev/go/scanner) adapter when a compatible existing `go` executable is found. Internal options are `mode: "auto"` (default), `"official"`, or `"builtin"`, and an optional absolute `executable` path. Go versions 1.20-1.27 pass only after a capability probe checks Unicode/BOM positions, CRLF, block comments, strings and `//line` directives. In auto mode, missing or incompatible Go tools select the built-in fallback with a recorded reason. The selector exposes `backend`, `extract(source)` and `close()`; callers must await `close()` after all extraction finishes.

The official helper is fixed source from this package. It is compiled once per scan into a temporary directory, with Go's build cache, GOPATH and temporary files pointed there. Network module lookup, toolchain downloads, project workspaces, startup configuration and cgo are disabled for this build. The helper reads committed source as JSON through stdin and calls `go/scanner` with `ScanComments`; it never builds or executes the scanned project. Go's scanner may strip CRs from returned token text and `//line` can alter display positions, so the helper returns byte offsets and Node reconstructs original comment text and UTF-16 positions. Each source is limited to 8 MiB. Helper execution has a 10-second limit and bounded output; compilation has a 120-second limit. The temporary directory is removed on `close()` or when preparation fails.

Errors in source produce diagnostics with no partial comments. Once selected, a helper failure, timeout, invalid response or version change is surfaced rather than silently falling back. No user-facing CLI flags or configuration keys were added. The focused Go and committed-source run passed 64 tests with no failures; its real-Go integration check was skipped because Go was not on PATH. No Go runtime or package was installed. The extractor is not yet wired into reporting.

## Rust extraction

`extractRustComments(source)` recognises line and nested block comments, including `///`, `//!`, `/** ... */` and `/*! ... */` documentation forms. It skips ordinary, byte and C strings; raw strings with up to 255 delimiter hashes; character and byte literals; raw identifiers; and lifetimes. These rules follow the [Rust comments](https://doc.rust-lang.org/reference/comments.html) and [token](https://doc.rust-lang.org/reference/tokens.html) descriptions. Raw comment bodies and UTF-16 positions refer to the original source; LF ends a line and CRLF is preserved in blocks.

The lexer returns `invalid` with no partial comments for unclosed comments or literals, invalid escapes and malformed raw delimiters. Block nesting beyond 128 levels returns `unsupported`. It does not expand macros, execute build scripts or validate a complete Rust program. A `//` or `/*` within a string stays hidden; comments in macro source remain visible as source comments. Rust documentation syntax does not permit a bare CR in a doc comment, so that returns a diagnostic.

This chunk uses the built-in lexer. Rust is not installed in the development environment, and no runtime was installed. Unit and committed-source integration cases have been added but not run at the user's request. The extractor is not yet wired into reporting.

The committed-source scan now feeds a code-finding snapshot. Each flagged comment is one finding, even when it contains several markers; the oldest blamed marker supplies its age and primary author. The snapshot retains skipped, invalid, and unsupported files, along with the selected extraction backends. Age categories use the saved custom bounds or divide the range beyond `fresh` into three automatic bands through the oldest code finding. A separate code view applies fresh inclusion, author and `type=code` filters, then orders the matching findings and calculates their displayed counts and oldest item. The `graveyard` command runs this code-only pipeline for committed local or fetched remote branch refs and prints the terminal renderer. It can also save a new Markdown report. Branch/issue debt, cross-type age calculation, summaries, and cached latest exports remain later steps.
