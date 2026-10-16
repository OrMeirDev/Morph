# אימות מקומי של Morph על Windows (מחשב שולחני, ללא הרשאות מוגבהות)

<div dir="rtl">

תאריך: 16.10.2026. התוצאות כאן **מקומיות** ונפרדות מתוצאות ה-CI (`docs/TESTING.md`, ריצה 38766954377).
הראיות: `test-results/local-windows/` (ריצות שהוחלפו בגלל תיקונים שמורות ב-`superseded/`).

## 1. מה נבדק ואיפה

| שדה | ערך |
| --- | --- |
| קוד שנבדק | commit `0f2d970` (ענף `claude/dazzling-johnson-3zccoi`, על בסיס `1112bd3`). אחריו שונו רק `.gitignore` ותיעוד |
| גרסת האפליקציה | `1.0.4-local`, ‏`release\win-unpacked\Morph.exe` (ארוזה: `app.asar`, ‏sharp מתוך `app.asar.unpacked`, המנועים ב-`resources\bin`, העוזר ב-`resources\native\morph-confine.exe`, SHA-256 ‏`1ef66280…a521b`) |
| Windows | Windows 11 Pro 26H2, build 26300.9711, x64 |
| חומרה | i7-14700K, 28 מעבדים לוגיים, RAM ‏31.7 GB, דיסק C פנוי כ-375 GB (NTFS) |
| מנועים | FFmpeg 9.0.2, 7-Zip 26.03, Poppler 26.09.0, LibreOffice 26.2.6.3, Calibre 9.15.0, sharp 0.35.5 — הורדו מחדש לפי `engines.lock.json`, כל הורדה נבדקה ב-SHA-256, ו-`bin/` זהה בית-לבית ל-`bin-manifest.json` לפני הבדיקות ואחריהן |
| כלי בנייה | Node 22.22.2, ‏MSVC 19.50.35730 (Build Tools 2026) |

### הקשר החשבון והאסימון (בכל הריצות)

| | |
| --- | --- |
| חשבון | `OR-MEIR-TSARFAT\or0727` (חשבון Microsoft) |
| סוג | **מנהל שרץ ללא הגבהה** (`administrator-unelevated`) |
| אסימון | `TokenElevationType = limited`, ‏`TokenElevation = 0`, רמת שלמות **Medium**, ‏`BUILTIN\Administrators` = ‏"Group used for deny only" |
| UAC | פעיל (`EnableLUA=1`) |

- **חשבון רגיל אמיתי (לא מנהל) לא נבדק.** במחשב אין חשבון כזה, ולא יצרתי חשבון ולא שיניתי חברות בקבוצות.
- בנוסף, בדיקת רגרסיה מפעילה את בדיקת המנועים דרך `runas /trustlevel:0x20000` (אסימון "Basic User": ‏Administrators חסום, Medium). זה מכסה את המקרה גם בשרתי CI מוגבהים, אבל **זה עדיין אותו משתמש** ואינו מחליף חשבון רגיל אמיתי.
- `context.json` בכל תיקיית ראיות מתעד את ההקשר הזה. אף שלב לא רץ מוגבה.

## 2. תוצאות (ריצה סופית על `0f2d970`, ללא הגבהה)

| # | בדיקה | סטטוס | ראיה |
| --- | --- | --- | --- |
| 1 | `npm test` עם המנועים הארוזים | **Pass** — 254 בדיקות: 249 עברו, 0 נכשלו, 5 דולגו | `npm-test.log`. הדילוגים: FAT32/exFAT/SMB (ראו 11) |
| 2 | אבחון בידוד מ-PowerShell (`confine-diagnose --strict`) | **Pass** — 8/8 מצבים נשלחים, 0 פרופילים שנשארו | `confine-diagnose.json` |
| 3 | אפליקציה ארוזה: smoke | **Pass** 20/20 | `smoke.json` (כולל בדיקה חדשה שהפרופיל הזמני באמת נוצל) |
| 4 | אפליקציה ארוזה: בדיקה מקומית מלאה (`e2e/local-windows-check.cjs`) | **Pass** 46/46 + מגבלה ידועה אחת | `local-check.json`, ‏`local-check.log` |
| 5 | זרימת UI אמיתית (`e2e:flow`, בנייה עם hooks, פרופיל זמני) | **Pass** 15/15 (ראיה תומכת) | `e2e-flow.log` |
| 6 | עלייה וזיהוי: כל המנועים מאומתים, בידוד `enforced`, ‏sharp נטען מ-`app.asar.unpacked` | **Pass** | S1–S3 |
| 7 | זיהוי קבצים בעובד הכלוא | **Pass** | D1–D4: העובד רץ תחת `morph-confine.exe`; 10 קבצים סווגו לפי תוכן (כולל PNG בשם `.jpg`, ‏`renamed: "jpg"`); אף אחת מ-25 שורות הפקודה של תהליכי Morph לא הכילה נתיב של קובץ מקור. קריאת הבתים בתיווך: `confinedDetection.test`, ‏`isolation.test` |
| 8 | המרות דרך intake ו-coordinator, תוצאות שנבדקו לפי תוכן | **Pass** — ראו טבלה 2א | C1–C12 |
| 9 | ביטול ותהליכי עזר | **Pass** — ראו טבלה 2ב | X1–X3, ‏P1–P2 |
| 10 | גבולות הבידוד | **Pass** | `isolation.test`/`confinement.test`: ‏canary מחוץ ל-workspace לא נכתב; קריאה וכתיבה למקור נכשלו ב-EPERM; ‏job B לא קרא את ה-workspace של job A (‏pdfinfo ‏I/O Error, ‏image worker ‏EPERM); ‏ffmpeg לא הגיע לשרת loopback (0 חיבורים) ולא לאינטרנט, כשהמארח כן הגיע |
| 11 | פרסום על FAT32/exFAT/SMB | **Pending** | דורש יצירת VHD ושיתוף עם הרשאות מנהל; לא הורץ |
| 12 | גרירה מהסייר | **Pending** (דורש פעולה פיזית) | ראו §6 |
| 13 | הצגה בסייר (Show in Explorer) | **Pass** | U1: חלון סייר נפתח על תיקיית הפלט ונסגר; U2: פתיחת קובץ מקור שלא נוצר ע"י Morph נדחתה (`not-a-morph-output`) |
| 14 | החסן USB אמיתי | **Pending** | אין התקן נשלף מחובר |
| 15 | Defender / SmartScreen / נעילות קבצים | **Pass** חלקי / **Pending** | Defender: הגנה בזמן אמת פעילה; 0 זיהויים ו-0 אירועי 1116/1117 היום; אף שגיאת נעילה בכל הריצות. ‏SmartScreen: ‏Pending (הבנייה המקומית בלי Mark-of-the-Web; צריך מתקין שהורד) |
| 16 | מתקין והתקנה מעל גרסה קודמת | **Pending** | לא ניתן לבודד בחשבון זה (§5) |
| 17 | עדכון מתוך האפליקציה (feed מקומי) | **Pending** | אותה סיבה (§5) |
| 18 | חתימת קוד | **Pending** | `Morph.exe` ו-`morph-confine.exe` לא חתומים (אין תעודה) |

### 2א. המרות (האפליקציה הארוזה, שמות בעברית עם רווחים)

| מנוע | המרה | מה נבדק בפלט |
| --- | --- | --- |
| sharp | PNG ← WEBP | פורמט webp, ‏64×48 כמו במקור, ערוץ אלפא נשמר |
| sharp | PNG ← WEBP בנתיב באורך 218 תווים | webp ‏32×32 |
| LibreOffice | ‏DOCX עברי ← PDF | ‏pdftotext: כל שורות השיר ("אני מאמין", טשרניחובסקי), בסדר הנכון |
| LibreOffice | ‏XLSX ← CSV | ‏69 שורות, Alabama עם נתוני אוכלוסייה |
| Calibre | ‏EPUB ← MOBI | כותרת `BOOKMOBI`; ‏ebook-meta קורא בחזרה "Alice's Adventures in Wonderland" |
| Calibre | ‏EPUB עברי ← DOCX | הטקסט העברי נמצא ב-`document.xml`; **מגבלה צפויה (E4): כיוון הפסקאות RTL ‏(`w:bidi`) לא נשמר** |
| Poppler | ‏PDF ← TXT | ‏54,031 תווים, "Request for Taxpayer" |
| Poppler | ‏PDF עברי ← PNG | שני עמודי PNG ‏1653×2339 |
| FFmpeg | ‏WAV ← MP3 | ‏mp3 ‏22,050 Hz, ‏2.00 שניות |
| FFmpeg | ‏MP4 ← WEBM | ‏vp9 ‏320×240 + opus, ‏3.01 שניות |
| 7-Zip | ‏ZIP ← 7Z | חתימת 7z; שם הרשומה העברי והתוכן "שלום" נשמרו |
| — | שם פלט קיים | נוצר `תמונה לבדיקה (1).webp`; הפלט הקודם לא השתנה |

כל 16 קובצי המקור שמרו על ה-SHA-256 שלהם (R2). ה-hashes נרשמו לפני הבדיקה ואחריה ב-`local-check.json`.

### 2ב. ביטול, סיום תהליך-אב והתאוששות (זיהוי לפי PID + זמן יצירה + קובץ הפעלה)

| בדיקה | מה נמדד |
| --- | --- |
| X1 תמונה ← AVIF ‏(6000×6000) | העובד הכלוא (`Morph.exe` תחת `morph-confine.exe`) נראה רץ במצב `converting` → Stop דרך `window.morph.cancel` → מצב `cancelled`; העוזר וכל צאצאיו הסתיימו (לפי זהות); ה-workspace נראה בזמן העבודה ונמחק; אין פלט; המקור ללא שינוי; ההמרה הבאה הצליחה |
| X2 ‏LibreOffice ‏(ODT עם 40,000 פסקאות ← PDF) | ‏`soffice.bin` נראה רץ → אותן תוצאות; ההמרה הבאה (DOCX ← ODT) הצליחה |
| X3 ‏Calibre (ספר עם 120 פרקים ← PDF) | ‏`ebook-convert` ו-`calibre-parallel` נראו רצים → אותן תוצאות; ההמרה הבאה הצליחה |
| P1 הריגת `Morph.exe` בלבד (בלי `/T`) באמצע LibreOffice | כל 11 הצאצאים (renderer/GPU, שני עוזרים, conhost, ‏soffice.com, ‏soffice.bin) הסתיימו |
| P2 הפעלה מחדש | היומן התרוקן (1 ← 0), ה-workspaces נמחקו (2 ← 0), אין פלט חלקי או קובצי `.~morph-`, פרופיל ה-AppContainer שנשאר מהקריסה נוקה (1 ← 0), ההמרה הבאה הצליחה |
| רגרסיות מחזור החיים (`workerLifecycle.test`) | הצלחה ממתינה לסגירת העוזר; הסטטיסטיקה זמינה; תוצאה סופית כושלת של העוזר גוברת על תשובת הצלחה מוקדמת — עברו בתוך `npm test` |

## 3. כשלים שנמצאו ותוקנו

כל כשל שוחזר ונשמרו לו ראיות לפני השינוי. לכל אחד נוספה רגרסיה, ואומת שהיא נכשלת לפני התיקון ועוברת אחריו.

| # | כשל | סוג | שחזור / ראיה | תיקון | רגרסיה |
| --- | --- | --- | --- | --- | --- |
| F1 | **LibreOffice ו-Calibre לא זמינים לאף משתמש שאינו מוגבה** (כל ההמרות של מסמכים וספרים) | מוצר, חמור | ‏`confinement-failed:soffice:CreateWindowStation failed (Windows error 5)` (`probe.before-fix.json`). מדידת P/Invoke: יצירת window station **בעלת שם** נכשלת ב-5 בלי הרשאות מנהל, ותחנה ללא שם מצליחה. ה-CI רץ מוגבה ולכן הבעיה לא נראתה שם | ‏`morph-confine.c`: ‏desktop פרטי עם שם ייחודי על תחנת החלון ללא השם של ה-logon session (כמו Chromium) | ‏`confinement.test`: בדיקת LibreOffice ו-Calibre מאסימון Basic User דרך `runas /trustlevel:0x20000` |
| F2 | **ניקוי פרופילי AppContainer בהפעלה לא ניקה דבר**, ובדיקות "לא נשאר פרופיל" לא יכלו להיכשל | מוצר + ראיה ריקה ב-CI | ‏Windows שומר monikers באותיות קטנות; ‏`--list-profiles Morph.Job.` החזיר 0 בעוד שבמחשב הצטברו 8 | ‏`_wcsnicmp` | ‏`confinement.test`: יצירת פרופיל באותיות מעורבות וקריאת ה-registry ישירות. בדיקת הקריסה ב-`isolation.test` בודקת עכשיו את החוזה האמיתי: קריסה משאירה פרופיל, והניקוי בהפעלה הבאה מסיר אותו (העוזר מת יחד עם Morph בגלל job ה-kill-on-close של Node/Electron) |
| F3 | זיכרון x264 גדל עם מספר הליבות: ‏4202 MiB ב-4K על 28 תהליכונים (מגבלה 6656; ב-CI נמדד 1634). במחשב גדול יותר ההמרה הייתה נכשלת עם `limit-memory` | מוצר (סיכון) | ‏`x264-threads-measurement.json`: ברירת מחדל 4202, ‏16 → ‏2395, ‏8 → ‏1787 MiB | הגבלה ל-16 תהליכונים (‏+0.1 שניות ל-30 פריימים ב-4K). **המגבלה לא הוגדלה** | ‏`engines.test` (‏`-threads` ≤ 16); ‏stress test משתמש עכשיו בארגומנטים של ה-adapter |
| F4 | ‏`packaged-smoke.cjs` "בפרופיל זמני" כתב בפועל ל-`%APPDATA%\Morph` **האמיתי** | בדיקה (עם נזק אמיתי) | ‏Electron מוצא את userData דרך known folder, לא דרך `APPDATA`. גם ריצת הבדיקה המקומית שלי נכשלה כך (ראו §4) | ‏`--user-data-dir`, ובדיקה שהפרופיל שנבחר באמת נוצל | בדיקה חדשה ב-smoke ‏(20/20), ‏R3 בבדיקה המקומית ובדיקת חותמות זמן חיצונית: הפרופיל האמיתי לא השתנה |
| F5 | ‏`fetch-engines` נכשל מ-Git Bash (`tar: Cannot connect to C:`) | כלי פיתוח | ‏`fetch-engines.gitbash-fail.log` | ‏`tar.exe` ו-`msiexec.exe` של Windows בנתיב מלא | ‏`fetchEngines.test` עם PATH ריק |
| F6 | ‏`morph-confine.json` רשם "'vswhere.exe' is not recognized" כגרסת המהדר | כלי פיתוח | בנייה מקומית עם VS 2026 | ‏vswhere ב-PATH של vcvars | הבנייה רושמת `19.50.35730`; ה-hash של העוזר לא השתנה |
| F7 | בדיקת הרשת נכשלה בבקרה ("המארח לא מגיע לאינטרנט") | סביבה + שבריריות בדיקה | ‏`www.example.com` לא נפתר (DNS) במחשב הזה, בעוד ש-github.com החזיר 200 | הבקרה בוחרת את המארח הראשון שהמחשב מגיע אליו מתוך רשימה, ו-ffmpeg הכלוא נבדק מול אותו מארח | אותה בדיקה; ה-assertions לא שונו |

## 4. אירוע: הבדיקות כתבו לפרופיל Morph האמיתי — ומה שוחזר

הרצה של `packaged-smoke.cjs` ושל הבדיקה המקומית שלי (לפני F4) כתבה ל-`C:\Users\or072\AppData\Roaming\Morph`:

- **`history.json`:** נוספו 21 רשומות בדיקה, והקובץ הומר לפורמט v1, ש-Morph 1.0.3 המותקן אינו יודע לקרוא (דף ההיסטוריה ורישום היסטוריה אחרי המרה היו נשברים). לפני הבדיקות ההיסטוריה שלך הייתה **ריקה**: 0 רשומות legacy, וכל 21 הרשומות הצביעו לתיקיות הבדיקה. **שוחזר** ל-`[]`, הפורמט ש-1.0.3 כותב.
- **`jobs.json` ו-`DevToolsActivePort`:** נוצרו ע"י הבדיקות, והרשומה היחידה ביומן הצביעה לנתיב בדיקה. **נמחקו.**
- **מטמונים שנוצרו היום ע"י הבדיקות:** `GPUPersistentCache`, ‏`ShaderCache`, ‏`GrShaderCache`, ‏`DIPS*`, ‏`declarative_performance_observer.db*` ו-`loprofile-aa33a4`. **נמחקו** (לפי שם ותאריך יצירה בלבד).
- **`settings.json`:** **לא השתנה** (שינוי אחרון: 13.10).
- **`Local State` ו-`Preferences`:** עודכנו ע"י Chromium של Electron 44 ולא ניתן להחזיר אותם בדיוק. אלה קובצי מצב של Chromium ולא נתונים שלך.
- **גיבוי** של המצב שאחרי הבדיקות (לפני השחזור) נשמר מחוץ למאגר, ב-scratchpad של הסשן הזה. הוא לא נכנס ל-git.
- **8 פרופילי AppContainer `morph.job.*`** שהצטברו מהבדיקות היום (ראו F2) נמחקו בעזרת ה-sweep של Morph עצמו. המצב הנוכחי: 0.

ההתקנה עצמה (`%LOCALAPPDATA%\Programs\Morph`) ומטמון העדכונים לא נגעו (חותמות הזמן מ-13.10).

## 5. מה לא הורץ ולמה (Pending)

- **מתקין ועדכון:** ‏`installer-check.cjs` ו-`autoupdate-check.cjs` כותבים במכוון ל-`%APPDATA%\Morph` ול-`%LOCALAPPDATA%\Programs\Morph`. מתקין ה-NSIS משתמש באותו מפתח הסרה (per-user, אותו appId) של Morph 1.0.3 שלך, ולכן היה מריץ את מסיר ההתקנה שלו. אי אפשר לבודד את זה בחשבון הזה. **נוהל מבודד:** חשבון Windows רגיל נפרד (בעל HKCU/APPDATA/LOCALAPPDATA משלו) או מכונה וירטואלית. שם מריצים:
  `node e2e/installer-check.cjs old\Morph-Setup-1.0.3.exe release\Morph-Setup-1.0.4-ci.exe --new-version 1.0.4-ci --report installer.json`
  ואחר כך את שלב בניית ה-feed ו-`node e2e/autoupdate-check.cjs …`, כמו ב-`ci.yml`. כולל ביטול בזמן עדכון ושמירת הגדרות והיסטוריה.
- **FAT32/exFAT/SMB:** דורשים `diskpart`/`New-SmbShare` עם הרשאות מנהל. לא שיניתי דבר במכונה. המגבלה המתועדת (D2e: אין הגנת ACL ב-FAT32/exFAT) בתוקף, ולא נמדדה מחדש מקומית.
- **גרירה מהסייר, USB אמיתי, SmartScreen, חתימה:** ראו §6 ו-§7.

## 6. בדיקות שולחניות שדורשות אותך

**גרירה מהסייר (פעולה אחת):** הריצו את הפקודה הבאה. נפתחים Morph בפרופיל בדיקה מבודד וחלון סייר עם קובצי בדיקה בעברית:

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-windows\start-test-instance.ps1`

גררו את ארבעת הקבצים וגם את התיקייה `תיקייה לגרירה` לחלון Morph.
**צפוי:** ארבע שורות עם הסוג הנכון, הודעה שתיקיות לא נתמכות, ואחרי "המר הכול" ארבעה פלטים ליד המקורות.

**החסן USB:** חברו החסן, העתיקו אליו את התיקייה `בדיקות מורף` (העתקה בלבד, בלי לפרמט) והמירו ממנו קובץ אחד פעמיים.
**צפוי:** `שם.סיומת` ואחר כך `שם (1).סיומת`, בלי קובצי `.~morph-`.

## 7. מגבלות קיימות (לא השתנו)

- **LibreOffice ו-Calibre (רמת שלמות Low):** קוראים כל קובץ שהמשתמש יכול לקרוא, יש להם רשת, ויכולים לכתוב לתיקיות Low. נמדד שוב היום: Calibre כתב ל-`LocalLow`. האסימון המוגבל-כתיבה עדיין לא ממיר.
- **FAT32/exFAT:** לא מוגנים ע"י המנגנון מבוסס ה-ACL.
- **Calibre ‏EPUB ← DOCX:** כיוון פסקאות RTL לא נשמר (E4).
- **קריסה של Morph:** פרופיל ה-AppContainer של העבודה נשאר רשום עד ההפעלה הבאה, שמנקה אותו (נמדד ב-P2).

## 8. פעולות שנותרו לבעלים

1. **חשבון רגיל אמיתי:** ראו "הרצה תחת חשבון רגיל" בהמשך.
2. בדיקות המתקין והעדכון בחשבון נפרד או ב-VM (§5).
3. גרירה והחסן USB (§6).
4. תעודת חתימה ו-`MORPH_PUBLISHER` (F1 בבקלוג); ‏SmartScreen עם מתקין חתום שהורד.
5. החלטה על D2e (FAT32/exFAT) ועל חוק חומת אש למנועי Low (D2c).
6. CI על ה-PR: לוודא שהבדיקות החדשות (Basic User, רישום פרופילים) עוברות על השרת.

### הרצה תחת חשבון רגיל (לא מנהל)

1. העתיקו את תיקיית הריפו, **כולל** `bin\`, ‏`node_modules\`, ‏`native\out\` ו-`release\win-unpacked\`, לתיקייה שהחשבון הרגיל יכול לקרוא, למשל `C:\MorphValidation`.
2. ודאו ש-Node 22 זמין לחשבון הזה.
3. התחברו לחשבון הרגיל, פתחו PowerShell **רגיל**, ונווטו לתיקייה.
4. הריצו:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-windows\run-local-validation.ps1 -SkipBuild -AppExe C:\MorphValidation\release\win-unpacked\Morph.exe`
5. הסקריפט מסרב לרוץ מוגבה, רושם `context.json` (צפוי: `kind: standard-user`), ומריץ את האבחון, ‏`npm test`, ‏smoke והבדיקה המקומית. הראיות נשמרות ב-`test-results\local-windows\run-<תאריך>`.

## 9. בקלוג

| מזהה | פריט | סטטוס | חסום ע"י | חוסם את | מסלול |
| --- | --- | --- | --- | --- | --- |
| L1 | אימות תחת חשבון רגיל אמיתי | Pending | חשבון רגיל (בעלים) | אישור שחרור | QA |
| L2 | מתקין ועדכון מבודדים (חשבון נפרד/VM) | Pending | חשבון נפרד או VM | אישור שחרור | QA / Release |
| L3 | גרירה מהסייר והחסן USB | Pending | פעולה פיזית | W1 | QA |
| L4 | ‏FAT32/exFAT/SMB מקומית | Pending | הרשאות מנהל ליצירת VHD/שיתוף | — | QA |
| L5 | הבדיקות החדשות ב-CI | Ready | הרצת CI על ה-PR | מיזוג | CI |
| F1 | חתימת קוד; ‏SmartScreen | Pending | תעודה (בעלים) | אישור שחרור | Release |
| D2c | ‏LibreOffice/Calibre: קריאה, רשת, כתיבה לתיקיות Low | Partial | החלטת בעלים; פנימיות המנועים | בידוד מלא | Native + security |
| D2e | ‏FAT32/exFAT ללא הגנה | Open | החלטת בעלים | — | Application |
| E4 | ‏RTL בפסקאות Calibre ← DOCX | Optional | — | הסרת הערת המגבלה | Engine |

</div>
