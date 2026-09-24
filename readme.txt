=== NoteFlow – Notes, Checklists & Team Collaboration ===
Contributors: ankitmaru
Donate link: https://wpankit.com/
Tags: notes, admin notes, checklist, collaboration, dashboard
Requires at least: 6.0
Tested up to: 7.1
Stable tag: 2.0.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A calm, fast notes app in your WordPress admin: folders, checklists, tags and reminders, plus notes your team can share and edit together.

== Description ==

**NoteFlow** is a notes app that lives inside WordPress. Write down ideas, keep checklists, plan content and share notes with the people you work with, without leaving your dashboard or signing up for another service.

It looks and feels like the notes app on your computer: folders on the left, your notes in the middle, and a clean page to write on. Everything is saved as you type, and everything stays in your own WordPress database.

= Write the way you think =

* **Rich notes** with titles, headings, bulleted, dashed and numbered lists, block quotes, code, links, tables and images.
* **Checklists** with round tick boxes. Tick items off, move ticked items to the bottom, and see progress like 3/5 in the notes list.
* **Shortcuts as you type**: `[] ` starts a checklist, `- ` a list, `1. ` a numbered list, `# ` a title, `> ` a quote.
* **Autosave** while you write. There is no Save button to forget.
* **Paste from anywhere.** Formatting from Google Docs, Word and web pages is cleaned up. Paste or drop an image and it goes to your Media Library.

= Stay organised =

* **Folders** for your own notes, plus smart views: All Notes, Shared, Reminders and Recently Deleted.
* **Tags**: write `#launch` anywhere in a note and it shows up under Tags.
* **Pin** the notes you need most at the top.
* **Search** every note you can open, with matches highlighted.
* **List or gallery view**, sorted by date edited, date created or title, and grouped by Today, Yesterday, Previous 7 Days and so on.
* **Colours** to spot notes at a glance.
* **Light and dark appearance**, or follow your system.
* **Keyboard shortcuts** for almost everything. Press `?` to see them.
* **Recently Deleted**: deleted notes can be recovered for 30 days.

= Work together =

Notes are private until you share them. When you do, NoteFlow becomes a shared workspace:

* **Share with people** as viewers or editors, or with everyone who can use NoteFlow.
* **See who else is here.** Avatars show who has the note open, and who is typing.
* **Live updates.** Changes from other people appear in your note on their own.
* **Safe editing at the same time.** When two people edit a note at once, NoteFlow merges changes to different paragraphs, list items and table rows. If you both changed the same line, it asks which version to keep. It never silently overwrites someone's work.
* **Comments and @mentions** in each note's activity panel.
* **Version history** shows who changed a note and when. Preview any version and restore it.
* **Notifications** in NoteFlow and by email when a note is shared with you, when someone mentions you, and when a reminder is due. Everyone can turn emails off for themselves.

= Modules =

Switch each one on or off in NoteFlow → Settings.

* **Dashboard widget**: jot down a quick note and see pinned notes and upcoming reminders.
* **Quick capture**: a Note button in the toolbar, in the admin and on your site, to save an idea in seconds (Alt + Shift + N). On a post or page, you can attach the note to it.
* **Reminders**: set a date and time on a note and get notified when it is due.
* **Content notes**: attach notes to posts and pages. They appear in a Notes box in the editor, so feedback stays next to the content.
* **Templates**: meeting notes, to-do list, content brief, bug report, launch checklist and weekly plan.
* **Import and export**: download a note as Markdown or HTML, print it, and move all your notes between sites with a backup file.

= Private by default =

* Each note belongs to the person who wrote it. Nobody else can see it until they share it.
* Choose which roles can use NoteFlow. Administrators always can.
* Every request checks who owns the note and who it is shared with.
* Notes never appear on your site, in search results, in feeds, or in the REST API for posts.
* NoteFlow makes no requests to outside services. Profile pictures come from WordPress, as they do everywhere in the admin.

= Free, for good =

NoteFlow is completely free. No upsells, no locked features, no account to create and no tracking.

= More from the makers of NoteFlow =

* [Page Visit Counter](https://pagevisitcounter.com/): privacy-first analytics inside WordPress.
* [PushRow for Google Sheets](https://getpushrow.com/): keep Google Sheets in sync with WordPress.
* [UltimaKit](https://wordpress.org/plugins/ultimakit-for-wp/): admin tools, security and performance in one plugin.

== Installation ==

1. In your admin, go to Plugins → Add New Plugin and search for "NoteFlow".
2. Click Install Now, then Activate.
3. Open **NoteFlow** in the admin menu and write your first note.
4. Optional: go to NoteFlow → Settings to choose who can use NoteFlow and which modules are on.

== Frequently Asked Questions ==

= Who can see my notes? =

Only you, until you share a note. You can share it with specific people as viewers or editors, or with everyone who can use NoteFlow. Administrators cannot open your private notes in NoteFlow either. Like all content, notes are stored in the site's database and included when an administrator exports the site with Tools → Export.

= Who can use NoteFlow? =

By default administrators, editors, authors and contributors. You can change the roles in NoteFlow → Settings. Administrators always have access.

= Can several people edit the same note at the same time? =

Yes. Everyone sees who else has the note open, and changes appear in each other's editor within a few seconds. Edits to different paragraphs, list items or table rows are merged. If two people change the same line at the same moment, NoteFlow asks which version to keep.

= I used NoteFlow 1.x. What happens to my notes? =

They are all still there. In 1.x every NoteFlow user could see and edit every note, so NoteFlow 2.0 keeps those notes shared with everyone, as they were. New notes are private. You can make an older note private from its Share button. Pinned notes stay pinned for the person who wrote them.

= Where are notes stored? =

In your WordPress database, as a private post type. Comments, sharing and reminders are stored with them. Nothing is sent to an outside service.

= Can I move my notes to another site? =

Yes. With Import and export switched on, open Preferences in NoteFlow and choose Export All My Notes, then import the file on the other site. You can also export any single note as Markdown or HTML.

= How do reminders work? =

Set a date and time from a note's More menu. When it is due, you get a notification in NoteFlow and, if email notifications are on, an email. Reminders use WP-Cron, so on sites with little traffic they can arrive a few minutes late.

= Does it work with the block editor and the classic editor? =

Yes. The Notes box for content notes appears in both.

= Does it work on multisite? =

Yes. Each site has its own notes and settings.

= What happens when I delete the plugin? =

Your notes are kept, in case you install NoteFlow again. To remove everything, turn on "Delete all NoteFlow data when the plugin is deleted" in NoteFlow → Settings before you delete the plugin.

== Screenshots ==

1. The notes app: folders, pinned notes, and a checklist shared with the team.
2. Share a note with people as viewers or editors, or with everyone.
3. Comments and @mentions next to the note, with everyone who has it open shown at the top.
4. Version history: see who changed what, preview any version and restore it.
5. Gallery view, in dark appearance.
6. Quick capture from the toolbar, and the Dashboard widget.
7. Notes attached to a post, in the block editor.
8. Settings: choose who can use NoteFlow and which modules are on.

== Changelog ==

= 2.0.0 - 2026-09-24 =

NoteFlow has been rebuilt from the ground up.

* New: a notes app with folders, smart views, tags, pinned notes, list and gallery views, search, light and dark appearance, and keyboard shortcuts.
* New: writing with checklists, headings, lists, quotes, code, tables, links and images, shortcuts as you type, and autosave.
* New: share notes with people as viewers or editors, or with everyone.
* New: see who else has a note open, get their changes live, and edit at the same time safely.
* New: comments with @mentions, version history with restore, and email notifications.
* New modules: Dashboard widget, quick capture, reminders, content notes, templates, and import and export.
* New: NoteFlow → Settings, to choose who can use NoteFlow and which modules are on.
* Security: notes are now private to their owner, and every request checks the person's access to that note. Please update.
* Removed: the Freemius SDK and the promotional notice.
* Upgrading keeps all 1.x notes, shared with everyone as before. Pins stay with each note's author.

= 1.6.0 - 2026-02-24 =
* Minor fixes and improvements.

= 1.5.1 - 2026-01-31 =
* Minor fixes and improvements.

= 1.5.0 - 2025-11-25 =
* Minor fixes and improvements.

= 1.0.2 - 2025-04-03 =
* Minor fixes and improvements.

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 2.0.0 =
A new notes app with sharing, checklists and reminders, and an important security fix. Your 1.x notes are kept and stay shared with everyone, as before.
