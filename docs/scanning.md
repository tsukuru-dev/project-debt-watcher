# Comment scanner: current implementation

Branch selection, committed source reads, initial JavaScript/TypeScript, Python and Ruby comment lexers, CSS comment extraction, and official Python/Ruby tool adapters are implemented. Marker matching, blame and report integration remain pending. The `graveyard` command still reports that generation is pending.

`selectBranches` snapshots every named local branch by default. Remote scope snapshots existing remote-tracking branches from all remotes, excluding symbolic aliases such as `origin/HEAD`. Tags are excluded. An empty repository returns no branches. Detached HEAD does not add an unnamed branch to the set. Different branches pointing to the same commit remain separate snapshots.

Each snapshot records the full ref, display name, scope and commit ID. Later reads use that immutable commit rather than resolving the branch again. Moving or deleting a branch during a scan therefore does not change the saved source snapshot. Files come from commits, not the staging area or working directory. Untracked files and uncommitted edits are not included in this layer.

`listSourceFiles` enumerates regular tracked blobs throughout the commit tree, including executable source files. Symlinks and submodules are excluded. No implicit folder exclusions are applied: tracked source in a vendor/generated directory remains a candidate. Candidate extensions cover Python, Ruby, JavaScript/Node, JSX, TypeScript, TSX, CSS, C++ and headers, Rust, Go, and HTML/Django templates. Classification selects a language-specific extractor; several language extractors are still pending.

Filenames are preserved using Git's NUL-delimited tree output. Blob reads use full object IDs, so spaces, tabs, newlines, colons or shell characters in filenames are never interpreted as shell commands or revision expressions. The same APIs support SHA-1 and SHA-256 object IDs. Reads work from nested directories and linked worktrees without changing the checkout or index.

Source reads return either text or an explicit skip reason. The initial per-file limit is 8 MiB; larger files are marked `too-large`. Files containing NUL bytes are marked `binary`, and invalid UTF-8 is marked `invalid-utf8`. Empty files are valid text. UTF-8 BOMs and line endings are preserved for later line/offset tracking. Callers can supply a different byte limit; this is an internal API parameter, not a new configuration setting or CLI option. Future reporting must expose skipped-file diagnostics rather than silently treating them as files with no debt.

Branch listings and tree listings have bounded output buffers (8 MiB and 32 MiB respectively). Exceeding these bounds fails instead of returning truncated results. Invalid filenames that cannot be decoded as UTF-8, invalid object IDs, missing objects and Git errors also fail explicitly.

These reads require Git 2.45 or newer for `--no-lazy-fetch`. They do not fetch refs or missing objects, run text-conversion filters, or apply Git replacement objects. Partial clones with missing objects must be prepared through the user's normal Git workflow before scanning.

## Language-specific comment syntax

Markers remain plain text such as `TODO` or `FIXME`. The language extractor determines which text is actually inside a comment before marker matching happens.

| Language | Comment syntax | Status |
| --- | --- | --- |
| JavaScript / TypeScript / Node | `// ...`, `/* ... */`, including JSDoc | Initial lexer implemented, with limitations below |
| JSX / TSX / React | JS comments in expressions, including `{/* ... */}`; plain JSX text is not a comment | Pending |
| Python | `# ...`; quoted strings and triple-quoted docstrings are not comments | Official tokenizer adapter plus limited built-in fallback |
| Ruby | `# ...`, column-one `=begin` / `=end` blocks | Ripper adapter plus limited built-in fallback; real-Ruby verification pending in the current environment |
| C++ and headers | `// ...`, `/* ... */` | Pending |
| Rust | `// ...`, `/* ... */`, including nested block comments | Pending |
| Go | `// ...`, `/* ... */` | Pending |
| CSS | `/* ... */` | Implemented for plain CSS; see scope below |
| Django / HTML templates | `{# ... #}`, `{% comment %} ... {% endcomment %}`, `<!-- ... -->` | Pending |

Ruby classification includes `.rb`, `.rake`, `.gemspec`, and exact filenames `Gemfile` and `Rakefile`. ERB templates are not covered. The requirements also include C and PHP. Their classification and extraction support remain future chunks; this table does not imply all required languages are implemented.

## Shared extraction helpers

`source.ts` shares source-position lookup and comment-record construction. Each extractor supplies its newline rules and comment-body boundaries. String, escape and token rules remain language-specific. All extractors return the same `CommentExtraction` type, ready for common marker matching and blame integration later.

## JavaScript and TypeScript extraction

`extractJavaScriptComments(source, language)` is a dependency-free lexer. It recognises line and block comments, skips quoted strings and supported regex literals, and enters `${...}` template expressions while leaving template text untouched. It preserves comment order, raw text, delimiter-free bodies, and positions for both. Positions use zero-based UTF-16 offsets, one-based lines/columns, and exclusive ends. Whitespace, JSDoc stars, UTF-8 BOMs, CRLF and Unicode line separators are retained in the original source representation.

Successful extraction returns `status: "ok"` and the comments, including comments without debt markers. This is not a JavaScript/TypeScript compiler or complete grammar validator. Unterminated strings/comments/regexes/templates and unbalanced delimiters produce `status: "invalid"`. Syntax requiring an unimplemented rule produces `status: "unsupported"`. Both return a position and diagnostic with no partial comments. Future reporting must surface these diagnostics rather than report the file as debt-free.

The first lexer chunk deliberately leaves JSX/TSX, decorators, escaped identifiers, legacy HTML-style JS comments, Unicode-set regexes and nested/literal opening brackets in regex classes unsupported. It also stops at uncertain regex-versus-division contexts, such as immediately after a closing brace, `await`/`yield`, ambiguous `>`/postfix `!`, or a TypeScript operand followed by a newline and slash. TypeScript angle-bracket assertions and generic arrows need a later rule. These restrictions can reject valid code; they must not silently trigger a plain-text marker search. Nested templates have a limit of 128 expression levels.

No Git calls, file writes, source execution, module imports from scanned code or project configuration loading occur during extraction. Tests separately check the lexer and its use with committed-source reads. It is not yet wired into the report command.

## CSS extraction

`extractCssComments(source)` extracts non-nesting `/* ... */` comments from plain CSS. Quoted strings and unquoted URL tokens are skipped; `//` is not a CSS comment. Escapes, escaped/case-insensitive `url` names, and surrounding token boundaries follow the [CSS Syntax tokenization rules](https://www.w3.org/TR/css-syntax-3/#tokenization).

Original text and UTF-16 offsets are retained. CSS line counting recognises CRLF, CR, LF and form feed; Unicode separators U+2028/U+2029 are not CSS newlines. CSS character replacement is applied only during token recognition, never to returned source text.

Malformed strings, escapes, URLs or unterminated comments return `invalid` with a position and no partial comments. This is deliberately stricter than browser error recovery. It is a comment lexer, not a declaration validator; it does not validate properties, nesting or balanced braces. SCSS, Sass, Less and embedded HTML styles are outside this extractor's scope. It never fetches URLs, follows imports or executes source.

## Python extraction

`createPythonCommentExtractor(options)` is the asynchronous official-tool-first entry point. Create it once per scan, then call its `extract(source)` method for each committed Python source. The returned `backend` records the name, version, executable for official extraction, or the fallback reason. It is not yet connected to `graveyard`.

Automatic selection searches absolute PATH directories for existing `python3`/`python` executables (with `.exe` on Windows), preserving PATH order. It skips relative entries, Windows Store aliases and `py` installation launchers. Only Python 3.12-3.14 passing a tokenizer capability probe is selected; older/newer or unavailable installations use the fallback. The upper bound is deliberate until newer versions are checked. A failed probe is recorded in the fallback reason. No runtime is downloaded or installed.

Internal options support `mode: "auto"` (default), `"official"` (fail if no suitable tool), or `"builtin"` (no discovery or subprocess). `executable` selects an absolute existing interpreter path with auto/official mode. These are internal API controls, not new CLI flags or configuration keys yet.

The fixed helper uses Python's [standard-library tokenizer](https://docs.python.org/3/library/tokenize.html), after syntax validation with `ast.parse`. F-string expression comments are supported; template strings require Python 3.14. Syntax newer than the selected interpreter understands is a source diagnostic, not a reason to switch scanners. Positions are mapped from Python code-point columns to our original UTF-16 offsets, preserving BOM and CRLF/CR/LF source text. Non-UTF-8 encoding declarations remain unsupported.

The helper receives JSON source via stdin and runs with `-I -S -B`: isolated imports, no site startup hooks and no bytecode writes. It runs from the interpreter's directory, with Python environment overrides removed, without a shell. It does not execute source statements or load project modules. Source is limited to 8 MiB; each subprocess has a 10-second timeout and 32 MiB output limit. Syntax errors return diagnostics with no partial comments. Process failures, malformed responses and version changes throw explicit extraction errors without fallback. Python's grammar validation is stricter than our built-in lexer's checks, so the two backends can reject different files.

### Built-in fallback

`extractPythonComments(source)` recognises Python 3 `#` comments, including shebangs, encoding cookies and type comments. It skips ordinary, raw, bytes and triple-quoted strings/docstrings, with case-insensitive `r`, `u`, `b`, `br` and `rb` prefixes. It follows [Python's lexical rules](https://docs.python.org/3/reference/lexical_analysis.html) for quote escaping, physical line endings and line joining. Text and UTF-16 positions remain unchanged; CRLF, CR and LF end lines, while form feed and Unicode separators do not.

F-strings and template strings (including raw combinations) return `unsupported` with no partial comments. Their expressions can contain real comments, so they require a dedicated follow-up rather than being skipped as ordinary text. Python 2 backtick syntax and active non-UTF-8 encoding declarations are also explicitly unsupported. Source reading currently supports UTF-8 only.

Unterminated strings, invalid line-joining backslashes and NUL characters return `invalid` with a diagnostic position and no partial results. This lexer does not validate indentation, expression grammar, escape values or bytes-literal contents. It never invokes Python, resolves imports or executes source.

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

Next chunks will expand fallback syntax support and other language extractors/official adapters, then connect marker matching, blame attribution and report generation. Report integration must expose incomplete coverage and record backend metadata.
