# رفوف (Rfoof) — منظّم المستندات والملفات

تطبيق ويب تقدّمي (PWA) احترافي لتنظيم المستندات والصور والملفات داخل مجلدات ملوّنة، يعمل بالكامل دون اتصال، يبحث داخل محتوى الملفات، ويحفظ نسخة احتياطية ويتزامن مع OneDrive بحيث تصل إلى مكتبتك من أي جهاز في العالم باسم مستخدم Microsoft وكلمة السر. الواجهة ثنائية اللغة (عربي/إنجليزي) مع دعم كامل للاتجاه من اليمين إلى اليسار.

> النسخة الإنجليزية من هذا الدليل: [README.md](README.md)

---

## المزايا

| الميزة | التفاصيل |
|---|---|
| **مجلدات ملوّنة** | 12 لونًا و40 أيقونة، مجلدات فرعية بلا حدود، سحب وإفلات للنقل، عدّادات الملفات |
| **تسمية ذكية عند الإضافة** | نافذة تسمية لكل ملف مع نمط قابل للتخصيص `{name} {date} {time} {folder} {n} {year} {month} {day}`، اقتراحات تلقائية للعناوين (مثل `IMG_20240912_101530.jpg` ← `Photo 2024-09-12`)، وسوم ولون لكل الدفعة، وكشف الملفات المكررة |
| **بحث فوري** | في العناوين والوسوم والملاحظات وأسماء المجلدات **وداخل محتوى** ملفات PDF و Word و Excel و PowerPoint والنصوص والأكواد، مع تطبيع عربي (الهمزات، التاء المربوطة، التشكيل، الأرقام الهندية) وإبراز النتائج |
| **عارض مدمج** | صور (تكبير/تحريك/تدوير)، PDF (pdf.js مع بحث داخل المستند وتحديد النص)، فيديو وصوت، Markdown، أكواد ملوّنة، Word (docx)، Excel/CSV (جداول بأوراق متعددة)، PowerPoint (pptx)، أرشيفات ZIP. الملفات القديمة (doc/ppt/xls/odt…) تُعرض عبر تحويل OneDrive إلى PDF عند تسجيل الدخول |
| **يعمل أوفلاين** | كل شيء محفوظ محليًا في IndexedDB مع Service Worker يحمّل التطبيق بلا إنترنت |
| **OneDrive** | تسجيل دخول بحساب Microsoft (OAuth 2.0 PKCE بلا مكتبات خارجية)، رفع ومزامنة ثنائية الاتجاه، مجلدات حقيقية داخل `OneDrive/Apps/Rfoof` بنفس هيكل التطبيق، سلة محذوفات، تنزيل الملفات عند الطلب أو إبقاء الكل أوفلاين |
| **نسخ احتياطي محلي** | تصدير المكتبة كاملة كملف ZIP منظّم واستعادتها |
| **سريع** | قوائم افتراضية (Virtualized) لآلاف الملفات، مصغّرات مخزّنة، فهرسة في الخلفية |
| **احترافي** | مظهر فاتح/داكن/تلقائي، 7 ألوان رئيسية، لوحة أوامر Ctrl+K، اختصارات لوحة مفاتيح، قوائم سياقية، تصميم متجاوب للهاتف، دعم فتح الملفات من مستكشف Windows ("فتح باستخدام") |

---

## محتويات المشروع

```
rfoof/
├── index.html              نقطة الدخول
├── manifest.webmanifest    بيان التطبيق (أيقونات، اختصارات، معالجة الملفات)
├── sw.js                   Service Worker للعمل دون اتصال (غيّر VERSION عند كل تحديث)
├── privacy.html            سياسة الخصوصية (عربي/إنجليزي) – مطلوبة للمتجر
├── licenses.html           تراخيص المكتبات مفتوحة المصدر
├── css/app.css             التصميم (فاتح/داكن، RTL)
├── js/
│   ├── config.js           ← ضع هنا Client ID الخاص بـ Microsoft
│   ├── app.js              تشغيل التطبيق والواجهة الرئيسية
│   ├── i18n.js             النصوص العربية والإنجليزية
│   ├── db.js / store.js    قاعدة البيانات المحلية وإدارة الحالة
│   ├── search.js           البحث والتطبيع العربي
│   ├── import.js           الإضافة والتسمية والمصغّرات وفهرسة المحتوى
│   ├── office.js           قراءة docx/xlsx/pptx/zip
│   ├── auth.js / graph.js / sync.js   تسجيل الدخول و Microsoft Graph والمزامنة
│   ├── license.js          الترخيص: نسخة المتجر / التجربة / مفاتيح الترخيص
│   ├── backup.js           النسخ الاحتياطي ZIP
│   ├── ui/                 الشريط الجانبي، الشبكة، التفاصيل، النوافذ، الإعدادات…
│   └── viewers/            عارض الملفات
├── vendor/                 pdf.js، JSZip، marked، highlight.js (نسخ محلية للعمل أوفلاين)
├── tools/license-key.html  مولّد مفاتيح الترخيص     ·  Rfoof-Desktop.bat  تشغيل محلي على Windows
├── icons/  screenshots/    أيقونات ولقطات شاشة جاهزة للمتجر
└── test/                   اختبارات وحدة (node test/sync.test.js)
```

لا يوجد أي خطوة بناء (Build): ارفع الملفات كما هي.

---

## الخطوة 1 — النشر على GitHub Pages

1. أنشئ مستودعًا جديدًا على GitHub باسم `rfoof` (عام Public).
2. ارفع **كل محتويات** المجلد إليه (يمكن السحب والإفلات من صفحة المستودع ← *Add file ▸ Upload files*). تأكد أن `index.html` في جذر المستودع.
3. من *Settings ▸ Pages*: المصدر **Deploy from a branch**، الفرع `main`، المجلد `/ (root)` ثم Save.
4. بعد دقيقة يصبح التطبيق متاحًا على: `https://haymohsen.github.io/Rfoof/` (استبدل اسم المستخدم إذا كان مختلفًا). هذا العنوان هو ما ستستخدمه في كل الخطوات التالية — **بالشرطة المائلة في النهاية**.

جرّب التطبيق الآن: أضف ملفات، أنشئ مجلدات، ابحث، ثم أغلق الإنترنت وأعد فتح الصفحة — يجب أن يعمل كاملًا.

---

## الخطوة 2 — تفعيل تسجيل الدخول و OneDrive (Microsoft Entra)

هذه الخطوة مجانية وتستغرق 5 دقائق، وهي ما يتيح "الوصول من أي مكان باسم المستخدم وكلمة السر".

1. افتح <https://entra.microsoft.com> وسجّل الدخول بحساب Microsoft (يمكن استخدام حساب outlook.com الشخصي؛ سيُنشأ لك دليل افتراضي تلقائيًا).
2. من القائمة: **Identity ▸ Applications ▸ App registrations ▸ + New registration**.
3. املأ:
   - **Name**: `Rfoof`
   - **Supported account types**: *Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)* — هذا الخيار ضروري ليعمل مع كل المستخدمين.
   - **Redirect URI**: اختر المنصة **Single-page application (SPA)** وأدخل `https://haymohsen.github.io/Rfoof/`
4. اضغط **Register**. في صفحة النظرة العامة انسخ **Application (client) ID** (يشبه `3f1a…-…`).
5. من **API permissions ▸ + Add a permission ▸ Microsoft Graph ▸ Delegated permissions** أضف:
   - `User.Read`
   - `Files.ReadWrite.AppFolder`
   - `offline_access`
   
   (لا حاجة لموافقة مسؤول Admin consent.)
6. من **Authentication** تأكد أن العنوان مسجّل تحت *Single-page application* وليس *Web* (وإلا سيفشل تبادل الرمز بسبب CORS). يمكنك إضافة `http://localhost:8080/` أيضًا للتجربة المحلية.
7. افتح ملف `js/config.js` وضع المعرّف:
   ```js
   msClientId: '3f1a....-....-....-....-............',
   ```
   ثم ارفع الملف إلى GitHub. (اختياريًا: من **Branding & properties** أضف شعار التطبيق `icons/icon-512.png` ورابط سياسة الخصوصية `https://haymohsen.github.io/Rfoof/privacy.html` ليظهرا في شاشة الموافقة.)
8. افتح التطبيق ← الإعدادات ← *الحساب و OneDrive* ← **تسجيل الدخول بحساب Microsoft**. بعد الموافقة ستجد ملفاتك في `OneDrive ▸ Apps ▸ Rfoof` وستتزامن مع أي جهاز تسجّل الدخول منه (تطبيق المتجر، أو المتصفح على أي حاسوب أو هاتف عبر نفس الرابط).

**كيف تعمل المزامنة؟** يُرفع كل ملف إلى مجلد OneDrive يطابق مجلده في التطبيق، ويُحفظ ملف `rfoof-index.json` يحتوي الوسوم والألوان والملاحظات والعناوين. عند تسجيل الدخول من جهاز جديد تُنزَّل القائمة فورًا وتُنزَّل الملفات نفسها عند فتحها (أو كلها إذا فعّلت "إبقاء جميع الملفات متاحة دون اتصال"). التعديلات من أجهزة مختلفة تُدمج بحسب الأحدث، والملفات المحذوفة تنتقل إلى `Apps/Rfoof/.Trash` حتى تُفرغ السلة.

---

## الخطوة 3 — التغليف للمتجر عبر PWABuilder

1. في **Partner Center** (<https://partner.microsoft.com/dashboard>) ← Apps and games ← **+ New product ▸ MSIX or PWA app** ← احجز الاسم `Rfoof` (أو `Rfoof – Documents Organizer` إن كان محجوزًا).
2. من صفحة المنتج ← **Product management ▸ Product identity** انسخ القيم الثلاث: **Package/Identity/Name**، **Package/Identity/Publisher**، **Publisher display name**.
3. افتح <https://www.pwabuilder.com> وأدخل `https://haymohsen.github.io/Rfoof/` ← **Start** ← **Package for stores ▸ Windows**.
4. الصق القيم الثلاث في النموذج، واتركِ باقي الخيارات الافتراضية، ثم **Download package**.
5. في Partner Center ← **Submission ▸ Packages** ارفع ملف `.msixbundle` (وملف `.classic.appxbundle` إذا وُجد داخل الحزمة نفسها).
6. أكمل بقية الطلب: التسعير، الفئة **Productivity**، التصنيف العمري، **Privacy policy URL** = `https://haymohsen.github.io/Rfoof/privacy.html`، اللقطات من مجلد `screenshots/`، والوصف أدناه. ثم Submit.

بعد النشر، أي تحديث ترفعه إلى GitHub Pages يصل تلقائيًا للمستخدمين دون إعادة إرسال للمتجر (فقط غيّر `VERSION` في `sw.js` و`version` في `config.js`). أعد الإرسال فقط إذا غيّرت الأيقونات أو بيانات `manifest.webmanifest`.

### نص جاهز لصفحة المتجر

**الوصف القصير (EN):** Organize documents, photos and files in colorful folders. Works offline, searches inside files, and syncs with your OneDrive so your library is with you everywhere.

**الوصف القصير (AR):** نظّم مستنداتك وصورك وملفاتك في مجلدات ملوّنة. يعمل دون اتصال، يبحث داخل الملفات، ويتزامن مع OneDrive لتكون مكتبتك معك في كل مكان.

**الوصف الكامل (EN):**
Rfoof is a fast, private home for everything you keep: contracts, certificates, invoices, lecture notes, photos and more.
• Colorful folders with icons and unlimited sub-folders
• Smart naming when you add files: patterns, suggestions, tags and color labels
• Instant search across titles, tags, notes and the text inside PDF, Word, Excel, PowerPoint and text files — in Arabic and English
• Built-in viewer for images, PDF, Office documents, spreadsheets, presentations, video, audio, code and ZIP archives
• 100% offline — your files stay on your device
• Optional OneDrive sync: sign in with your Microsoft account to back up your library and open it on any device
• Local ZIP backup, light & dark themes, keyboard shortcuts, Arabic and English interface

**الوصف الكامل (AR):**
رفوف هو مكان سريع وخاص لكل ما تحتفظ به: عقود، شهادات، فواتير، ملاحظات محاضرات، صور وغيرها.
• مجلدات ملوّنة بأيقونات ومجلدات فرعية بلا حدود
• تسمية ذكية عند الإضافة: أنماط واقتراحات ووسوم وألوان تمييز
• بحث فوري في العناوين والوسوم والملاحظات وداخل نصوص PDF و Word و Excel و PowerPoint والملفات النصية — بالعربية والإنجليزية
• عارض مدمج للصور و PDF ومستندات Office والجداول والعروض والفيديو والصوت والأكواد وأرشيفات ZIP
• يعمل دون اتصال بنسبة 100% — ملفاتك تبقى على جهازك
• مزامنة اختيارية مع OneDrive: سجّل الدخول بحساب Microsoft لحفظ نسخة احتياطية وفتح مكتبتك من أي جهاز
• نسخ احتياطي محلي ZIP، مظهر فاتح وداكن، اختصارات لوحة مفاتيح، واجهة عربية وإنجليزية

---

## الخطوة 4 — التسعير والبيع (شراء لمرة واحدة مدى الحياة)

### كيف يشتري الزبون التطبيق؟
1. يبحث عن **Rfoof** في متجر Microsoft (أو يفتح رابط الصفحة `https://apps.microsoft.com/detail/<Store ID>`).
2. يضغط **Buy** ويدفع بحسابه في Microsoft (بطاقة/باي بال/رصيد المتجر بحسب بلده).
3. يُثبَّت التطبيق تلقائيًا، وعند فتحه يكتشف التطبيق أنه أُطلق من حزمة المتجر ويفعّل **النسخة الكاملة** على ذلك الجهاز بلا أي خطوة إضافية.
4. الترخيص مرتبط بحساب Microsoft الخاص بالزبون: يمكنه تثبيته على أجهزته الأخرى من صفحة **My Library** في المتجر دون دفع مجددًا (حتى 10 أجهزة بحسب سياسة المتجر).

### كيف تضبط السعر ليكون دفعة واحدة مدى الحياة؟
في Partner Center داخل الـ Submission ← **Pricing and availability**:
- **Base price**: اختر فئة السعر (مثل 9.99 USD؛ يحوّلها المتجر تلقائيًا لعملات الأسواق الأخرى ويمكنك تخصيص كل سوق).
- هذا السعر هو **شراء لمرة واحدة** بطبيعته — لا يوجد اشتراك ما لم تُنشئ "إضافة" (Add-on) من نوع اشتراك، فلا تنشئ أي إضافة.
- **Free trial**: اتركها **No free trial**. نسخة التجربة الحقيقية موجودة داخل التطبيق نفسه (انظر أدناه) لأن تجربة المتجر تحتاج واجهات Windows لا تتوفر للتطبيقات من نوع PWA.
- **Markets**: اختر كل الأسواق أو حدّد ما تريد. **Visibility**: Public.
- **Sale pricing** (اختياري): يمكنك جدولة تخفيضات مؤقتة لاحقًا.

**حصة المتجر:** يحصل المطوّر على 85% من سعر التطبيقات (غير الألعاب) عند البيع عبر منصة Microsoft التجارية، وتُدفع الأرباح شهريًا إلى حسابك البنكي/PayPal بعد تجاوز الحد الأدنى للدفع. تسجيل حساب المطوّر **مجاني للأفراد** (نحو 99 دولارًا للشركات). (المصدر: [أسئلة Microsoft Store الشائعة](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-started-with-the-microsoft-store).)

### كيف يعمل الترخيص داخل التطبيق؟ (مهم جدًا)
لأن التطبيق من نوع PWA فرابطه على GitHub Pages عام، ولو تُرك مفتوحًا لأمكن لأي شخص استخدامه مجانًا من المتصفح متجاوزًا المتجر. لذلك يحتوي التطبيق على نظام ترخيص مدمج (`js/license.js`):

| الحالة | ماذا يحدث |
|---|---|
| فُتح من حزمة المتجر | يرسل Edge المُعرِّف `app-info://platform/microsoft-store` عند الإطلاق، فيُفعَّل التطبيق تلقائيًا ويُحفظ ذلك على الجهاز |
| فُتح من الرابط في المتصفح | **نسخة تجريبية**: كل المزايا تعمل لكن الإضافة محدودة بـ `trialImportLimit` ملفًا (الافتراضي 25) لكل جهاز، مع زر "احصل على النسخة الكاملة" يفتح صفحة المتجر |
| أدخل الزبون مفتاح ترخيص | يُفعَّل على أي جهاز (مثلًا هاتفه)؛ المفتاح يُتحقق منه محليًا بمقارنة SHA-256 |
| شُغِّل محليًا (`Rfoof-Desktop.bat` أو `localhost`) | يُعدّ نسخة المطوّر ويعمل كنسخة كاملة تلقائيًا |

ما عليك ضبطه في `js/config.js`:
```js
storeProductId: '9NBLGGH4R315',   // من Partner Center ← Product identity ← Store ID
trialImportLimit: 25,             // عدد الملفات المسموح إضافتها في النسخة المجانية (0 = تطبيق مجاني بلا حدود)
licenseKeyHashes: [ ... ],        // (اختياري) افتح tools/license-key.html لتوليد مفاتيح وبصماتها
```
- افتح `tools/license-key.html` في المتصفح ← Generate ← انسخ السطر إلى `config.js`. أعطِ المفتاح فقط لزبون اشترى التطبيق ويريد استخدامه في متصفح هاتفه.
- إن أردت جعل التطبيق **مجانيًا** بالكامل ضع `trialImportLimit: 0`.

### أكواد ترويجية (نسخ مجانية لك ولأصدقائك أو للمراجعين)
Partner Center ← **Attract ▸ Promo codes ▸ Order codes**: حتى 1600 كود لكل 6 أشهر للتطبيقات. يفتح الزبون الرابط، يسجّل الدخول، ويُثبَّت التطبيق مجانًا. (المصدر: [Generate promotional codes](https://learn.microsoft.com/en-us/windows/apps/publish/generate-promotional-codes).)

---

## استخدامه على حاسوبك الآن (سطح المكتب)

**الطريقة 1 — الأفضل: تثبيته كتطبيق من Edge** (بعد رفعه إلى GitHub Pages)
1. افتح `https://haymohsen.github.io/Rfoof/` في Microsoft Edge (العنوان حسّاس لحالة الأحرف: حرف **R** كبير كما يظهر تمامًا في Settings ▸ Pages على GitHub).
2. اضغط الزر الأزرق **تثبيت رفوف على هذا الجهاز** أسفل الشريط الجانبي (وهو موجود أيضًا في الإعدادات ← عام ← *التثبيت كتطبيق*). الطريقة نفسها متاحة من Edge: أيقونة التثبيت الصغيرة في طرف شريط العنوان، أو القائمة ⋯ ← **التطبيقات (Apps)** ← **تثبيت Rfoof**.
   لا يظهر الزر إلا عندما يعتبر المتصفح الموقع قابلًا للتثبيت، وهذا يتطلب HTTPS وتحميل الصفحة كاملة. إن لم تره: أعد التحميل بـ **Ctrl+F5**، وتأكد أنك في Edge أو Chrome (Firefox لا يثبّت تطبيقات الويب)، وتأكد أن التطبيق ليس مثبّتًا من قبل (عندها تجده في قائمة ابدأ ولا يعرض Edge تثبيته مجددًا).
3. يظهر رفوف في قائمة ابدأ وشريط المهام كنافذة مستقلة، يعمل أوفلاين ويحصل على التحديثات تلقائيًا. (هذه النسخة لك أنت؛ الزبائن يحصلون عليها من المتجر.)
4. لتفعيل النسخة الكاملة على جهازك دون شراء: أدخل مفتاحك الشخصي (بصمته موجودة مسبقًا في `config.js`، والمفتاح نفسه أُرسل إليك بشكل خاص — لا تكتبه في أي ملف عام) في الإعدادات ← الترخيص ← تفعيل. يمكنك توليد مفاتيح إضافية من `tools/license-key.html`.

**الطريقة 2 — بدون رفع أي شيء: تشغيل محلي من المجلد**
1. فكّ ضغط `rfoof.zip` في أي مكان (مثل `C:\Rfoof`).
2. انقر نقرًا مزدوجًا على **`Rfoof-Desktop.bat`** — يشغّل خادمًا محليًا صغيرًا (`tools/serve.ps1`) ويفتح التطبيق في نافذة Edge مستقلة. أبقِ النافذة السوداء مفتوحة أثناء الاستخدام. هذه النسخة المحلية تعمل دائمًا كنسخة كاملة (نسخة المطوّر).
3. إن ظهر تحذير SmartScreen اضغط *More info ▸ Run anyway* (السكربت محلي ولا يتصل بالإنترنت). لا يحتاج المشغّل صلاحيات مسؤول: يستخدم منفذ TCP عاديًا، وإن كان المنفذ 8080 مشغولًا يختار تلقائيًا المنفذ التالي المتاح ويطبعه في النافذة.
4. لاستخدام OneDrive من هذه النسخة أضف `http://localhost:8080/` كـ Redirect URI من نوع SPA في تسجيل Entra.

> ملاحظة: كل طريقة (الرابط، localhost، المتجر) لها مخزن بيانات مستقل في المتصفح؛ مزامنة OneDrive هي ما يوحّد مكتبتك بينها.

---

## التشغيل والاختبار محليًا

```bash
cd rfoof
python3 -m http.server 8080     # أو أي خادم ملفات ثابت
# ثم افتح http://localhost:8080/
node test/sync.test.js          # اختبارات محرّك المزامنة (12 اختبارًا)
node test/search.test.js        # اختبارات البحث والتسمية
node test/license.test.js       # اختبارات الترخيص والنسخة التجريبية
```

> ملاحظة: يجب فتح التطبيق عبر خادم (http/https) وليس بالنقر المزدوج على `index.html`، لأن Service Worker و ES Modules لا يعملان من `file://`.

---

## التخصيص السريع

| ماذا | أين |
|---|---|
| اسم التطبيق والإصدار ومعرّف Microsoft ومعرّف المتجر وحد النسخة التجريبية | `js/config.js` |
| النصوص العربية/الإنجليزية | `js/i18n.js` |
| الألوان الرئيسية والمظهر | أعلى `css/app.css` (متغيرات `--accent` …) وقائمة `ACCENTS` في `js/ui/settings.js` |
| ألوان المجلدات | `COLORS` في `js/store.js` |
| أيقونات المجلدات | `FOLDER_ICONS` في `js/icons.js` |
| المجلدات الافتراضية عند أول تشغيل | `STARTER` في `js/ui/welcome.js` |
| الشعار | `js/logo.js` ثم أعد توليد الأيقونات في `icons/` |
| حدود الفهرسة (عدد صفحات PDF، حجم النص) | `LIMITS` في `js/config.js` |

---

## حدود معروفة

- صور HEIC/TIFF تُحفظ وتُنزَّل لكن المتصفحات لا تعرضها.
- معاينة Word/PowerPoint داخل التطبيق "مبسّطة" (نص، صور، جداول). للمعاينة الكاملة اضغط زر السحابة في العارض (يتطلب تسجيل الدخول واتصالًا) وسيحوّل OneDrive الملف إلى PDF.
- ملفات PDF بخطوط CJK (صيني/ياباني) قد تحتاج مجلد `cmaps` من pdf.js — لم يُضمَّن لتقليل الحجم.
- المزامنة تعتمد على مجلد التطبيق في OneDrive (`Apps/Rfoof`) فقط ولا تصل إلى بقية ملفات OneDrive — وهذا مقصود لأسباب الخصوصية.

---

## الترخيص والمكتبات

كود التطبيق ملك لك. المكتبات المستخدمة: pdf.js (Apache-2.0)، JSZip (MIT)، marked (MIT)، highlight.js (BSD-3)، أيقونات Lucide (ISC). النصوص الكاملة في `vendor/` وصفحة `licenses.html`.
