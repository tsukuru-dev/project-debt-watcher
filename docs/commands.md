# Commands

Planned interface; these commands are not implemented yet. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: generate a report, with composable summary, filter, ordering, and save options.
- `debt-watcher config`: open or explicitly edit the selected configuration.
- `debt-watcher init`: create or repair team setup using the same flow as first-run setup.

`--save latest` exports a cached report without rescanning or changing its view. It must take a separate execution path from new-report generation.

The comment scanner is the first implementation stage. The stale-branch scanner comes next; issue scanners come last. Their future locations are `src/scanners/branches.ts` and `src/scanners/issues/`. The existing `src/git/branches.ts` serves branch selection for comment scanning and is separate from stale-branch detection.
