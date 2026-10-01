# Comment scanner: source-reading foundation

The first scanner chunk implements branch selection and committed source reads. It does not yet identify comments, match markers, run blame, or produce findings. The `graveyard` command still reports that generation is pending.

`selectBranches` snapshots every named local branch by default. Remote scope snapshots existing remote-tracking branches from all remotes, excluding symbolic aliases such as `origin/HEAD`. Tags are excluded. An empty repository returns no branches. Detached HEAD does not add an unnamed branch to the set. Different branches pointing to the same commit remain separate snapshots.

Each snapshot records the full ref, display name, scope and commit ID. Later reads use that immutable commit rather than resolving the branch again. Moving or deleting a branch during a scan therefore does not change the saved source snapshot. Files come from commits, not the staging area or working directory. Untracked files and uncommitted edits are not included in this layer.

`listSourceFiles` enumerates regular tracked blobs throughout the commit tree, including executable source files. Symlinks and submodules are excluded. No implicit folder exclusions are applied: tracked source in a vendor/generated directory remains a candidate. Candidate extensions cover Python, JavaScript/Node, JSX, TypeScript, TSX, CSS, C++ and headers, Rust, Go, and HTML/Django templates. This classification selects a future parser; it does not mean those parsers are implemented yet.

Filenames are preserved using Git's NUL-delimited tree output. Blob reads use full object IDs, so spaces, tabs, newlines, colons or shell characters in filenames are never interpreted as shell commands or revision expressions. The same APIs support SHA-1 and SHA-256 object IDs. Reads work from nested directories and linked worktrees without changing the checkout or index.

Source reads return either text or an explicit skip reason. The initial per-file limit is 8 MiB; larger files are marked `too-large`. Files containing NUL bytes are marked `binary`, and invalid UTF-8 is marked `invalid-utf8`. Empty files are valid text. UTF-8 BOMs and line endings are preserved for later line/offset tracking. Callers can supply a different byte limit; this is an internal API parameter, not a new configuration setting or CLI option. Future reporting must expose skipped-file diagnostics rather than silently treating them as files with no debt.

Branch listings and tree listings have bounded output buffers (8 MiB and 32 MiB respectively). Exceeding these bounds fails instead of returning truncated results. Invalid filenames that cannot be decoded as UTF-8, invalid object IDs, missing objects and Git errors also fail explicitly.

These reads require Git 2.45 or newer for `--no-lazy-fetch`. They do not fetch refs or missing objects, run text-conversion filters, or apply Git replacement objects. Partial clones with missing objects must be prepared through the user's normal Git workflow before scanning.

Next chunk: comment extraction for one language family, tested independently of Git blame and report rendering. Other language parsers, marker matching, blame attribution and report integration follow as separate chunks.
