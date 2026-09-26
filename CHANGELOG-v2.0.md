# Rfoof 2.0.3 — honest storage figure

- Since Chrome / Edge 144 the browser tells web apps that at most 10 GB are free (`quota = usage + min(10 GiB, free space)`), to stop sites from detecting private browsing. The real limit did not change (about 60% of the disk, within the free space). Settings ▸ Storage and the sidebar now say "more than 10 GB" with a short explanation instead of a bar that suggested the library would be full at 10 GB (`db.storageInfo()` in `js/db.js`, `js/ui/settings.js`, `js/ui/sidebar.js`, new strings `settings.availableMore`, `settings.quotaCapped`).
- Version 2.0.3.

---

# Rfoof 2.0.2 — Arabic search inside PDFs and Excel fixed

- **Arabic PDFs**: many PDFs (notably Edge / Chrome "Save as PDF") draw Arabic one glyph at a time, right to left, in presentation forms. The extracted text came out reversed and spaced letter by letter, so nothing Arabic inside those PDFs could be found. New `js/pdftext.js` rebuilds each line from the glyph positions (right-to-left order, numbers and Latin words kept left-to-right, brackets un-mirrored, real word gaps only, presentation forms → ordinary letters). Used for indexing (`js/import.js`) and for "find in document" in the PDF viewer (`js/viewers/pdfView.js`). Pages without Arabic keep the previous behaviour unchanged.
- **Excel**: text typed as inline strings (written by many tools other than Excel) and text results of formulas were not indexed; only shared strings were. `xlsxText` in `js/office.js` now reads them too.
- **Existing libraries**: on first start of 2.0.2, PDFs and Excel files already in the library are indexed once more in the background, so old files become searchable too.
- Search result cards start the one-line snippet just before the match, so the highlighted word stays visible.
- New `test/pdftext.test.js` with real pdf.js output as fixtures (`test/fixtures/pdf-items.json`); `sw.js` precaches `js/pdftext.js`; version 2.0.2.

---

# Rfoof 2.0.1 — Store link, ratings, restore limit

- `js/config.js`: `storeProductId` = `9NKH02WXWH03` (the live Store listing), new `storeCampaignId` = `rfoof-app`. The "Get the full version" button now opens the Store page, tagged `?cid=rfoof-app` so Partner Center ▸ Acquisitions shows the purchases that started inside the app.
- **Rate Rfoof**: a button in Settings ▸ License and Settings ▸ About, plus one polite, one-time reminder (after 3 days and 20 files). Shown only to owners (Store or license-key activations), since only owners can rate in the Store. Opens `ms-windows-store://review/?ProductId=…`.
- **Free version**: restoring a backup (folder or ZIP) now counts toward the same file limit as adding files; before, a restore could bypass it. Store / key owners are not affected.
- New strings `license.restoreBlocked`, `rate.*` (EN + AR); tests for Store links and rating rules; `sw.js` / `config.js` / `package.json` version 2.0.1.

Upload the changed files over the old ones on GitHub; no new Store submission is needed.

---

# Rfoof 2.0.0 — offline-first, backup anywhere

OneDrive sync and the Microsoft sign-in are gone. Nothing to register in Entra, no client ID, no account. The library stays on the device and is backed up, on demand, into any folder the user picks.

## New: Settings ▸ Backup

- **Backup folder** (Edge / Chrome, incl. the Store app): pick any folder once — local disk, USB stick, or the sync folder of Google Drive / Dropbox / OneDrive / iCloud. Rfoof writes `Library/<Folder>/<Sub>/<Title>.<ext>`, `Trash/…`, `rfoof-index.json` (titles, tags, colors, notes) and `README.txt`. The folder is remembered (**Back up now**), repeated backups copy only new files, and nothing in the folder is ever deleted.
- **Restore from folder**: pick a backup folder on any device. Existing files are skipped, folders with the same name under the same parent are merged (no duplicate starter folders).
- **ZIP** export / restore kept for every browser, with the identical layout (a ZIP can be unzipped into a backup folder and vice-versa).
- Backup file names are unique case-insensitively (safe on Windows / macOS drives).

## Removed

- `js/auth.js`, `js/graph.js`, `js/sync.js`, `test/sync.test.js` and all OAuth / Microsoft Graph code.
- `msClientId`, `msAuthority`, `msScopes`, `msFallbackScopes`, `cloudFolderName` from `js/config.js`.
- Settings ▸ *Account & OneDrive* tab, the cloud/sync button and account avatar in the top bar, the sync command in the Ctrl+K palette, the sign-in button on the welcome screen, the OneDrive PDF conversion for legacy Office files, and the per-file sync pill in the details panel.
- The pending-changes queue in IndexedDB (no longer written; leftovers from 1.x are cleared on first start).

## Changed

- `js/backup.js` rewritten (folder + ZIP, shared index format, shared restore logic).
- `js/ui/settings.js`: new Backup pane; `js/app.js`, `js/store.js`, `js/ui/actions.js`, `js/ui/details.js`, `js/ui/palette.js`, `js/ui/welcome.js` simplified.
- `js/i18n.js`: new `backup.*` strings (EN + AR); OneDrive wording removed from welcome, trial and wipe texts.
- `sw.js` precache list and `VERSION` = 2.0.0; `config.js` version = 2.0.0; `manifest.webmanifest`, `index.html` descriptions.
- `privacy.html` (EN + AR): the OneDrive section replaced by a "Backup folder" section.
- `README.md` / `README.ar.md`: Entra setup removed; backup instructions, Store listing text and known limits updated.

## Upgrading from 1.x

Just upload the new files over the old ones. Libraries already stored on a device are kept; the old `auth.js` / `graph.js` / `sync.js` can be deleted from the repository (they are no longer referenced). Anyone who had files only in OneDrive can find them in `OneDrive/Apps/Rfoof`, organized in the same folders, and drag them into the app again.
