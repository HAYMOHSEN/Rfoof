# Rfoof (رفوف) — Documents & Files Organizer

A professional Progressive Web App that organizes documents, photos and files in colorful folders, works fully offline, searches inside file contents, and backs up / syncs with OneDrive so the library is reachable from any device in the world with a Microsoft username and password. Bilingual interface (English / Arabic, full RTL).

> الدليل بالعربية: [README.ar.md](README.ar.md)

---

## Features

| Feature | Details |
|---|---|
| **Colorful folders** | 12 colors, 40 icons, unlimited sub-folders, drag & drop, file counters |
| **Smart naming on import** | Per-file title editing with a customizable pattern `{name} {date} {time} {folder} {n} {year} {month} {day}`, automatic title suggestions (`IMG_20240912_101530.jpg` → `Photo 2024-09-12`), batch tags & color labels, duplicate detection |
| **Instant search** | Titles, tags, notes, folder names **and the text inside** PDF, Word, Excel, PowerPoint, text and code files. Arabic-aware normalization (hamza forms, taa marbuta, diacritics, Arabic-Indic digits) with highlighted results |
| **Built-in viewer** | Images (zoom / pan / rotate), PDF (pdf.js with find & text selection), video & audio, Markdown, syntax-highlighted code, Word (docx), Excel / CSV (multi-sheet tables), PowerPoint (pptx), ZIP listings. Legacy Office formats (doc / ppt / xls / odt …) are previewed through OneDrive's PDF conversion when signed in |
| **Offline first** | Everything lives in IndexedDB; a service worker loads the app without internet |
| **OneDrive** | Microsoft sign-in (OAuth 2.0 + PKCE, no third-party library), two-way sync, real folders mirrored under `OneDrive/Apps/Rfoof`, cloud trash, download-on-demand or keep-everything-offline |
| **Local backup** | Export the whole library as an organized ZIP and restore it |
| **Fast** | Virtualized grid/list for thousands of files, cached thumbnails, background indexing |
| **Polished** | Light / dark / system theme, 7 accent colors, Ctrl+K command palette, keyboard shortcuts, context menus, responsive phone layout, Windows "Open with" file handling |

---

## Project layout

```
rfoof/
├── index.html              entry point
├── manifest.webmanifest    PWA manifest (icons, shortcuts, file handlers)
├── sw.js                   service worker for offline use (bump VERSION on every release)
├── privacy.html            privacy policy (EN/AR) – required by the Store
├── licenses.html           open-source licenses
├── css/app.css             styles (light/dark, RTL)
├── js/
│   ├── config.js           ← put your Microsoft client ID here
│   ├── app.js              bootstrap & shell
│   ├── i18n.js             English / Arabic strings
│   ├── db.js / store.js    IndexedDB + state
│   ├── search.js           search & Arabic normalization
│   ├── import.js           import, naming, thumbnails, content indexing
│   ├── office.js           docx / xlsx / pptx / zip reading
│   ├── auth.js / graph.js / sync.js   sign-in, Microsoft Graph, sync engine
│   ├── license.js          licensing: Store edition / trial / license keys
│   ├── backup.js           ZIP backup
│   ├── ui/                 sidebar, grid, details, dialogs, settings …
│   └── viewers/            file viewer
├── vendor/                 pdf.js, JSZip, marked, highlight.js (local copies → offline)
├── tools/license-key.html  license key generator   ·  Rfoof-Desktop.bat  local Windows launcher
├── icons/  screenshots/    Store-ready icons and screenshots
└── test/                   unit tests (node test/sync.test.js)
```

There is **no build step** — upload the files as they are.

---

## Step 1 — Publish on GitHub Pages

1. Create a new public repository on GitHub named `rfoof`.
2. Upload **all** contents of this folder (drag & drop on the repository page → *Add file ▸ Upload files*). `index.html` must be at the repository root.
3. *Settings ▸ Pages*: Source **Deploy from a branch**, branch `main`, folder `/ (root)` → Save.
4. After a minute the app is live at `https://haymohsen.github.io/rfoof/` (replace the user name if different). Use this exact URL — **with the trailing slash** — in every step below.

Try it: add files, create folders, search, then go offline and reload — it must keep working.

---

## Step 2 — Enable Microsoft sign-in & OneDrive (Microsoft Entra)

Free, about five minutes, and it is what makes "access from anywhere with username and password" work.

1. Open <https://entra.microsoft.com> and sign in with a Microsoft account (a personal outlook.com account works; a default directory is created automatically).
2. **Identity ▸ Applications ▸ App registrations ▸ + New registration**.
3. Fill in:
   - **Name**: `Rfoof`
   - **Supported account types**: *Accounts in any organizational directory (Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)* — required so every user can sign in.
   - **Redirect URI**: platform **Single-page application (SPA)**, value `https://haymohsen.github.io/rfoof/`
4. **Register**, then copy the **Application (client) ID** from the Overview page.
5. **API permissions ▸ + Add a permission ▸ Microsoft Graph ▸ Delegated permissions**: add `User.Read`, `Files.ReadWrite.AppFolder`, `offline_access`. No admin consent is needed.
6. **Authentication**: make sure the URI is listed under *Single-page application* (not *Web*), otherwise the token exchange fails because of CORS. You may also add `http://localhost:8080/` for local testing.
7. Put the ID in `js/config.js` and upload the file:
   ```js
   msClientId: '3f1a....-....-....-....-............',
   ```
   Optional: under **Branding & properties** add the logo (`icons/icon-512.png`) and the privacy URL (`https://haymohsen.github.io/rfoof/privacy.html`) so they appear on the consent screen.
8. In the app: Settings ▸ *Account & OneDrive* ▸ **Sign in with Microsoft**. After consenting, the library appears in `OneDrive ▸ Apps ▸ Rfoof` and syncs with every device you sign in on (the Store app, or the same URL in any browser on any computer or phone).

**How sync works.** Every file is uploaded into a OneDrive folder that mirrors its Rfoof folder, and `rfoof-index.json` stores titles, tags, colors and notes. A new device downloads the list immediately and fetches file bytes when a file is opened (or all of them with *Keep all files available offline*). Edits from different devices merge last-writer-wins; deleted files move to `Apps/Rfoof/.Trash` until the trash is emptied.

---

## Step 3 — Package for the Microsoft Store with PWABuilder

1. In **Partner Center** (<https://partner.microsoft.com/dashboard>) → Apps and games → **+ New product ▸ MSIX or PWA app** → reserve the name `Rfoof` (or `Rfoof – Documents Organizer` if taken).
2. On the product page → **Product management ▸ Product identity**: copy **Package/Identity/Name**, **Package/Identity/Publisher** and **Publisher display name**.
3. Open <https://www.pwabuilder.com>, enter `https://haymohsen.github.io/rfoof/` → **Start** → **Package for stores ▸ Windows**.
4. Paste the three values, keep the defaults, **Download package**.
5. In Partner Center → **Submission ▸ Packages** upload the `.msixbundle` (and the `.classic.appxbundle` if present in the same download).
6. Complete the submission: pricing, category **Productivity**, age rating, **Privacy policy URL** = `https://haymohsen.github.io/rfoof/privacy.html`, screenshots from `screenshots/`, and the listing text below. Submit.

After publishing, any update you push to GitHub Pages reaches users automatically without a new Store submission (just bump `VERSION` in `sw.js` and `version` in `config.js`). Resubmit only when icons or `manifest.webmanifest` change.

### Ready-to-paste Store listing

**Short description (EN):** Organize documents, photos and files in colorful folders. Works offline, searches inside files, and syncs with your OneDrive so your library is with you everywhere.

**Short description (AR):** نظّم مستنداتك وصورك وملفاتك في مجلدات ملوّنة. يعمل دون اتصال، يبحث داخل الملفات، ويتزامن مع OneDrive لتكون مكتبتك معك في كل مكان.

**Full description (EN):**
Rfoof is a fast, private home for everything you keep: contracts, certificates, invoices, lecture notes, photos and more.
• Colorful folders with icons and unlimited sub-folders
• Smart naming when you add files: patterns, suggestions, tags and color labels
• Instant search across titles, tags, notes and the text inside PDF, Word, Excel, PowerPoint and text files — in Arabic and English
• Built-in viewer for images, PDF, Office documents, spreadsheets, presentations, video, audio, code and ZIP archives
• 100% offline — your files stay on your device
• Optional OneDrive sync: sign in with your Microsoft account to back up your library and open it on any device
• Local ZIP backup, light & dark themes, keyboard shortcuts, Arabic and English interface

(The Arabic full description is in `README.ar.md`.)

---

## Step 4 — Pricing & selling (one-time, lifetime purchase)

### How a customer buys it
1. Searches for **Rfoof** in the Microsoft Store (or opens `https://apps.microsoft.com/detail/<Store ID>`).
2. Clicks **Buy** and pays with the payment method attached to their Microsoft account.
3. The app installs; on first launch it detects that it was started from the Store package and unlocks the **full version** on that device — no extra step.
4. The license belongs to the customer's Microsoft account: they can install it on their other devices from **My Library** in the Store without paying again (up to 10 devices per Store policy).

### Setting a one-time lifetime price
In Partner Center → your submission → **Pricing and availability**:
- **Base price**: pick a price tier (e.g. 9.99 USD; the Store converts it for other markets and you can override per market).
- A base price is by nature a **one-time purchase**. There is no subscription unless you create a subscription *add-on* — so simply don't create any add-on.
- **Free trial**: leave **No free trial**. The real trial lives inside the app (see below), because Store-managed trials need Windows APIs that PWAs cannot call.
- **Markets**: all or a selection. **Visibility**: Public. **Sale pricing** (optional) lets you schedule temporary discounts later.

**Revenue share:** for non-game apps sold through Microsoft's commerce platform the developer keeps 85%; payouts go monthly to your bank/PayPal once the minimum threshold is reached. Developer registration is **free for individuals** (about $99 for companies). (Source: [Microsoft Store FAQ](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-started-with-the-microsoft-store).)

### How licensing works inside the app (important)
Because a PWA is hosted at a public URL, anyone could otherwise use it free in a browser and bypass the Store. Rfoof therefore ships with a built-in license system (`js/license.js`):

| Situation | Behaviour |
|---|---|
| Launched from the Store package | Edge sends the referrer `app-info://platform/microsoft-store`; the app activates itself and remembers it on that device |
| Opened from the URL in a browser | **Free trial**: every feature works, but adding files is capped at `trialImportLimit` (default 25) per device, with a "Get the full version" button that opens the Store listing |
| A license key is entered | Unlocks any device (e.g. the customer's phone); keys are verified locally by SHA-256 |
| Run locally (`Rfoof-Desktop.bat` / `localhost`) | Treated as the developer's copy → always the full version |

Configure in `js/config.js`:
```js
storeProductId: '9NBLGGH4R315',   // Partner Center → Product identity → Store ID
trialImportLimit: 25,             // files that can be added in the free version (0 = free app, no limit)
licenseKeyHashes: [ ... ],        // optional: open tools/license-key.html to generate keys + hashes
```
- Open `tools/license-key.html` in a browser → Generate → paste the line into `config.js`. Hand a key only to a customer who bought the app and wants it in a phone browser.
- To make the app completely **free**, set `trialImportLimit: 0`.

### Promotional codes (free copies for yourself, friends or reviewers)
Partner Center → **Attract ▸ Promo codes ▸ Order codes**: up to 1,600 codes per 6 months for apps. The customer opens the redeem link, signs in, and installs for free. (Source: [Generate promotional codes](https://learn.microsoft.com/en-us/windows/apps/publish/generate-promotional-codes).)

---

## Using it on your own desktop right now

**Option 1 — best: install it as an app from Edge** (after publishing to GitHub Pages)
1. Open `https://haymohsen.github.io/rfoof/` in Microsoft Edge.
2. Click the **Install app** icon in the address bar (or ⋯ menu → Apps → Install Rfoof).
3. Rfoof appears in the Start menu and taskbar as its own window, works offline and updates automatically. (This copy is for you; customers get theirs from the Store.)
4. To unlock the full version on your own machine without buying: enter your personal key (its hash is already in `config.js`; the key itself was sent to you privately — never write it into a public file) in Settings → License → Activate. Generate more keys with `tools/license-key.html`.

**Option 2 — no upload needed: run locally from the folder**
1. Unzip `rfoof.zip` anywhere (e.g. `C:\Rfoof`).
2. Double-click **`Rfoof-Desktop.bat`** — it starts a tiny local server (`tools/serve.ps1`) and opens the app in a standalone Edge window. Keep the black window open while you use the app. This local copy always runs as the full version (developer copy).
3. If SmartScreen warns, click *More info ▸ Run anyway* (the script is local and makes no internet connections). No administrator rights are needed: the launcher uses a plain TCP socket, and if port 8080 is busy it automatically picks the next free port and prints it in the window.
4. To use OneDrive from this copy, add `http://localhost:8080/` as an SPA redirect URI in the Entra registration.

> Each way of opening the app (URL, localhost, Store) has its own browser data store; OneDrive sync is what unifies your library across them.

---

## Run & test locally

```bash
cd rfoof
python3 -m http.server 8080     # any static file server works
# open http://localhost:8080/
node test/sync.test.js          # sync engine tests (12 scenarios against a mock OneDrive)
node test/search.test.js        # search & naming tests
node test/license.test.js       # licensing / trial tests
```

> The app must be served over http/https; ES modules and service workers do not run from `file://`.

---

## Quick customization

| What | Where |
|---|---|
| App name, version, Microsoft client ID, Store ID, trial limit | `js/config.js` |
| English / Arabic strings | `js/i18n.js` |
| Accent colors & theme tokens | top of `css/app.css` and `ACCENTS` in `js/ui/settings.js` |
| Folder colors | `COLORS` in `js/store.js` |
| Folder icons | `FOLDER_ICONS` in `js/icons.js` |
| Starter folders on first run | `STARTER` in `js/ui/welcome.js` |
| Logo | `js/logo.js`, then regenerate `icons/` |
| Indexing limits (PDF pages, text size) | `LIMITS` in `js/config.js` |

---

## Known limits

- HEIC / TIFF images are stored and downloadable but browsers cannot display them.
- Word / PowerPoint previews inside the app are "basic" (text, images, tables). For a pixel-perfect preview press the cloud button in the viewer (requires sign-in and internet); OneDrive converts the file to PDF.
- PDFs with CJK fonts may need pdf.js's `cmaps` folder, which was left out to keep the download small.
- Sync only touches the app folder in OneDrive (`Apps/Rfoof`) — by design, for privacy.

---

## License & libraries

Your application code is yours. Bundled libraries: pdf.js (Apache-2.0), JSZip (MIT), marked (MIT), highlight.js (BSD-3), Lucide icons (ISC). Full texts in `vendor/` and `licenses.html`.
