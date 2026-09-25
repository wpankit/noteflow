# wordpress.org listing assets

The icon, banners and screenshots for **NoteFlow** on wordpress.org live in
[`.wordpress-org/`](../../.wordpress-org). This folder holds what builds them. Neither
folder is part of the plugin: `.gitattributes` marks both `export-ignore`, so they never
reach the plugin zip.

## How they reach wordpress.org

wordpress.org serves listing assets from the **`/assets/` directory of the SVN
repository**, not from `trunk/` or a tag. The **Deploy to WordPress.org** workflow copies
`.wordpress-org/` there with every release, and **Update readme and assets on
WordPress.org** does it between releases, so `.wordpress-org/` must hold only these files:

| File | Size | Used for |
| --- | --- | --- |
| `banner-772x250.png` | 772x250 | Standard banner |
| `banner-1544x500.png` | 1544x500 | High-DPI banner |
| `icon.svg` | vector | Plugin icon, used where supported |
| `icon-256x256.png`, `icon-128x128.png` | | Icon fallbacks (required with an SVG icon) |
| `screenshot-1.png` … `screenshot-22.png` | | Screenshots; captions come from `== Screenshots ==` in `readme.txt` |

## Regenerating

```bash
node tools/wporg-assets/build-assets.mjs                                  # icon PNGs and banners
node tools/wporg-assets/build-assets.mjs --screenshots                    # also the screenshots
node tools/wporg-assets/build-assets.mjs --screenshots --only=app,share   # just those screenshots
```

Edit the copy and colours in `banner.html`, and the icon in `.wordpress-org/icon.svg`.
The script renders every PNG in headless Chrome at the exact size wordpress.org expects
and checks each file's dimensions. The icon also ships inside the plugin as
`assets/images/noteflow-icon.svg` (the app, settings page and review notice); keep the
two copies identical.

It needs **Google Chrome**, plus **puppeteer-core** and the **Inter** and **Manrope**
fonts from the WPAnkit Product theme's QA tools (`tools/qa`). The default path is the
`pushrow-lp` Local site; set `NF_QA_DIR` to use another.

### Screenshots

`--screenshots` also needs WP-CLI and a local WordPress site with NoteFlow active. Set
`NF_SITE_PATH`, `NF_SITE_URL` and `NF_DB_SOCKET` for a site other than the default Local
one.

1. Create the users `maria`, `rahul` and `sofia` if the site doesn't have them.
2. From the plugin folder, build the demo workspace: `wp eval-file tools/wporg-assets/demo.php`.
   It creates the demo user Priya Sharma with her notes, shares and discussions, and 8
   posts that are never published. Running it again replaces what the last run created.
3. Run the script with `--screenshots`.

The script signs people in through short-lived WP-CLI sessions and destroys them
afterwards. While it runs, a temporary must-use plugin limits the demo user's notes and
Posts screen to the demo content, so nothing else on the site shows up. It changes nothing
for other users and is removed when the script ends. Edits made for a screenshot are
never saved, except on a throwaway note that is deleted straight away.

The screenshot order is the `SHOTS` list in the script, and it must match the captions in
`readme.txt`.
