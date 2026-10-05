# Contributing to Project Debt Watcher

Thanks for helping make Debt Watcher better. We would rather improve this project together than maintain several separate versions. Please bring bug reports, ideas, and code changes to this repository.

GitHub calls code submissions **pull requests**; on GitLab, the equivalent is a **merge request**.

## Raise an issue

Search the [existing issues](https://github.com/tsukuru-dev/project-debt-watcher/issues) first. Open a new issue for a bug, language syntax gap, documentation problem, or feature idea. Include what you expected, what happened, and the steps to reproduce it. For scanner problems, a small source example and its language/file extension help us tell a real comment from text that only looks like one. Include your Node.js and Git versions when relevant. Remove credentials and private project details from examples.

For a larger behaviour change or a new dependency, discuss the approach in an issue before writing a large patch. Small, focused fixes can go straight to a pull request.

## Make a change

1. Create a branch for your change and keep the pull request focused on one problem.
2. Use Node.js 22 or newer, npm, and Git 2.45 or newer. Run `npm ci` to install the project's locked development dependencies.
3. Make the change. Add or update tests when they verify behaviour, especially for comment extraction, Git history, report output, or setup.
4. Run `npm test` before submitting. It builds the TypeScript project and runs the test suite. Optional language-tool tests may skip if their official tool is not installed; do not install one just to satisfy a skipped test.
5. Open a [pull request](https://github.com/tsukuru-dev/project-debt-watcher/pulls). Explain the problem, what changed, how you checked it, and link any related issue.

Debt Watcher favours built-in comment scanners and compatible **official** language tools that are already installed. Please discuss any proposed third-party parser or runtime dependency before adding it. Scanners should report files they cannot safely understand as unscanned, rather than claiming those files contain no debt.

Please avoid committing generated `dist/`, `node_modules/`, test output, secrets, or unrelated formatting changes.

## Review and licensing

We may ask for changes before merging, and an issue or pull request does not guarantee that a feature will be accepted. Debt Watcher is licensed under the [BSD 3-Clause License](LICENSE). That license permits redistribution of modified versions under its conditions; this guide asks contributors to bring improvements here, but does not require them to do so.
