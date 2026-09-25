# Contributing to NoteFlow

Thanks for helping improve NoteFlow. This guide explains how to report problems, suggest features and send code.

## Questions and support

Please ask on the [WordPress.org support forum](https://wordpress.org/support/plugin/noteflow/). GitHub issues are for bugs and feature ideas.

## Reporting a bug

Search the [open issues](https://github.com/wpankit/noteflow/issues) first. If the bug is new, open a [bug report](https://github.com/wpankit/noteflow/issues/new?template=bug_report.yml) with where it happens, the steps to reproduce it, the roles of the people involved, and your plugin, WordPress and PHP versions.

Found a security issue, such as someone seeing a note that wasn't shared with them? Please don't open an issue; follow [SECURITY.md](SECURITY.md) instead.

## Suggesting a feature

Open a [feature request](https://github.com/wpankit/noteflow/issues/new?template=feature_request.yml) and describe the problem it would solve.

## Translating

Translations are managed on [translate.wordpress.org](https://translate.wordpress.org/projects/wp-plugins/noteflow/).

## Contributing code

### Set up

1. Run WordPress locally, for example with [Local](https://localwp.com/), [wp-env](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/) or [DDEV](https://ddev.com/).
2. Fork this repository and clone your fork into `wp-content/plugins/noteflow`.
3. Run `composer install` to get the coding standards tools.
4. Activate the plugin and open **NoteFlow** in the admin menu. Its modules are under **NoteFlow → Settings**.
5. Add a second user, for example an editor, to try sharing, live editing, notifications and discussions.

There is no build step: the JavaScript and CSS in `assets/` are loaded as they are.

### How the code is organised

- `noteflow-notes.php` loads `includes/class-noteflow-plugin.php`, which starts everything else.
- `includes/` has one class per job. `NoteFlow_Access` decides who can use NoteFlow and what each person can do with a note. `NoteFlow_REST` is the REST API (`noteflow/v1`) that the notes app, the Dashboard widget and quick capture use. The other classes handle notes, comments, notifications, settings, and upgrades from 1.x.
- `includes/modules/` has one class per module that can be switched off under **NoteFlow → Settings**, such as Discussions, Reminders and Quick capture.
- `assets/js/app.js` is the notes app, `editor.js` its rich-text editor and three-way merge, `discussions.js` and `block-editor.js` the discussions in the editor, `quick.js` the quick notes, and `ui.js` the shared UI kit.

### Make your change

- Create a branch from `main`. `main` is protected, so every change arrives through a pull request.
- Keep each pull request to one topic.
- Follow the [WordPress Coding Standards](https://developer.wordpress.org/coding-standards/wordpress-coding-standards/php/). `composer lint` must pass; `composer format` fixes most issues.
- The code must keep working on PHP 7.4 and WordPress 6.0.
- Prefix new functions, hooks and options with `noteflow_` and new classes with `NoteFlow_`, and use the `noteflow` text domain. Keep existing names and the stored data formats: sites and other code rely on them.
- Notes are private until they are shared. Every REST route and screen must check access through `NoteFlow_Access`, and nothing should reveal a note to someone it isn't shared with.
- Escape output, sanitize input, and check capabilities and nonces.
- NoteFlow makes no requests to outside services. Keep it that way.

### Test it

Before opening the pull request, with `WP_DEBUG` on, try the flows your change touches, for example:

- writing, organising and searching notes;
- sharing a note as a viewer, as an editor and with everyone, and editing it from two browsers at once;
- discussions in the block editor and the classic editor;
- notifications, reminders and quick capture;
- and, as a user the note isn't shared with, that the note stays out of reach, in the app and in the REST API.

### Open the pull request

Fill in the template: what changed, why, and how you tested it. The checks (Coding Standards, PHP Lint and Plugin Check) must pass before the pull request is merged.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking part, you agree to follow it.

## License

By contributing, you agree that your contributions are licensed under the [GPL-2.0-or-later](LICENSE) license.
