// ============================================================
//  Rfoof – app configuration
//  Edit this file before publishing.
// ============================================================
export const APP = {
  name: 'Rfoof',
  nameAr: 'رفوف',
  version: '2.0.4',

  // ---- Offline-first, no cloud sync required ----
  // This version runs 100% locally. Users can export their library
  // to any folder (local drive, cloud service, USB drive, etc.)
  // for backup and portability.

  // Links shown in Settings → About
  website: '',
  supportEmail: '',
  privacyUrl: './privacy.html',

  // ---- Licensing (Microsoft Store edition) --------------------
  // The Store package activates the full version automatically (Edge launches the
  // app with the referrer "app-info://platform/microsoft-store"). The public web
  // URL runs as a free trial limited to `trialImportLimit` added files.
  //   storeProductId  : Partner Center → Product management → Product identity → "Store ID"
  //                     Used for the "Get the full version" and "Rate Rfoof" buttons.
  //   storeCampaignId : ?cid= tag on those Store links, so Partner Center's Acquisitions
  //                     report shows how many sales came from inside the app.
  //   trialImportLimit: files a device can add without a license. 0 = no limit (free app).
  //   licenseKeyHashes: SHA-256 hashes of license keys accepted in Settings → License.
  //                     Generate keys with tools/license-key.html and paste the hashes here.
  storeProductId: '9NKH02WXWH03',
  storeCampaignId: 'rfoof-app',
  trialImportLimit: 25,
  licenseKeyHashes: [
    'fa957db3b3337bd2d7936a6f33b2f05639a9463c4ee6a1f35dd82a464898ee36', // owner's personal key (the key itself is kept private)
  ],
};

export const LIMITS = {
  thumbSize: 360,          // px – longest side of generated thumbnails
  textIndexChars: 200000,  // max characters of extracted text kept per file
  pdfIndexPages: 40,       // max PDF pages scanned for search indexing
  maxWordsPerFile: 6000,   // max unique words indexed per file
  smallUpload: 4 * 1024 * 1024, // files above this use an upload session
  uploadChunk: 10 * 320 * 1024, // 3.2 MB (must be multiple of 320 KiB)
};
