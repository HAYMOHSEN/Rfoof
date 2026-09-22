// ============================================================
//  Rfoof – app configuration
//  Edit this file before publishing.
// ============================================================
export const APP = {
  name: 'Rfoof',
  nameAr: 'رفوف',
  version: '1.0.0',

  // ---- Microsoft account + OneDrive -------------------------
  // 1. Go to https://entra.microsoft.com  → Applications → App registrations → New registration
  // 2. Supported account types: "Personal Microsoft accounts and any organizational directory"
  // 3. Platform: "Single-page application", Redirect URI = the exact URL where this app is hosted,
  //    e.g. https://YOUR-USER.github.io/rfoof/   (keep the trailing slash)
  // 4. API permissions (delegated): User.Read, Files.ReadWrite.AppFolder, offline_access
  // 5. Copy "Application (client) ID" below.
  msClientId: '',
  msAuthority: 'https://login.microsoftonline.com/common',
  msScopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Files.ReadWrite.AppFolder'],

  // Name of the folder created inside the user's OneDrive (under "Apps/")
  cloudFolderName: 'Rfoof',

  // Links shown in Settings → About
  website: '',
  supportEmail: '',
  privacyUrl: './privacy.html',

  // ---- Licensing (Microsoft Store edition) --------------------
  // The Store package activates the full version automatically (Edge launches the
  // app with the referrer "app-info://platform/microsoft-store"). The public web
  // URL runs as a free trial limited to `trialImportLimit` added files.
  //   storeProductId  : Partner Center → Product management → Product identity → "Store ID"
  //                     (e.g. 9NBLGGH4R315). Used for the "Get the full version" button.
  //   trialImportLimit: files a device can add without a license. 0 = no limit (free app).
  //   licenseKeyHashes: SHA-256 hashes of license keys accepted in Settings → License.
  //                     Generate keys with tools/license-key.html and paste the hashes here.
  storeProductId: '',
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
