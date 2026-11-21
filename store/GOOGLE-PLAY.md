# העלאת סל חכם ל-Google Play

## איך האפליקציה בנויה

האפליקציה ב-Play היא "עטיפה" רשמית של Google (Trusted Web Activity) שפותחת את האתר החי במסך מלא, דרך Chrome שבטלפון. אין בה קוד משלה. לכן:

- **כל שינוי באתר מגיע מיד גם למשתמשי Play**, בלי להעלות גרסה חדשה.
- צריך להעלות גרסה חדשה ל-Play רק כשמשנים את השם, הסמל או הצבעים של האפליקציה עצמה.
- כדי שהאפליקציה תיפתח בלי שורת כתובת, האתר צריך "להכיר" בה: קובץ `/.well-known/assetlinks.json` באתר `guymaslawi.github.io` (שלב 6).

## מה כבר מוכן

| מה | איפה |
| --- | --- |
| פרויקט Android, נבנה ונבדק באמולטור | `android/` |
| סקריפט ליצירת מפתח העלאה | `android/make-upload-key.sh` |
| סקריפט לבניית הקובץ להעלאה | `android/build-release.sh` |
| טקסטים לדף האפליקציה ותשובות לשאלונים | `store/listing.md` |
| סמל, תמונה ראשית, 6 צילומי מסך | `store/` |
| מדיניות פרטיות | https://guymaslawi.github.io/sal-hacham/privacy.html |

## השלבים

### 1. מפתח העלאה (פעם אחת, כ-2 דקות)

```bash
cd android && ./make-upload-key.sh
```

הסקריפט שואל סיסמה שאתה בוחר, ושומר את המפתח ב-`~/sal-hacham-keys/upload.jks`. שמור את הקובץ ואת הסיסמה במקום בטוח, למשל במנהל סיסמאות. בסוף הוא מדפיס **טביעת אצבע SHA-256**; נצטרך אותה בשלב 6.

### 2. בניית הקובץ להעלאה

```bash
./build-release.sh
```

הקובץ: `android/app/build/outputs/bundle/release/app-release.aab`.

### 3. יצירת האפליקציה ב-Play Console

https://play.google.com/console → **Create app**:
- App name: `סל חכם – השוואת מחירי סופר`
- Default language: **Hebrew – he-IL**
- App or game: **App**. Free or paid: **Free**.
- מאשרים את ההצהרות (מדיניות המפתחים וחוקי ייצוא).

### 4. מילוי "Set up your app"

בלוח הבקרה של האפליקציה יש רשימת משימות. את כל התשובות אפשר להעתיק מ-`store/listing.md`: מדיניות פרטיות, גישה לאפליקציה, פרסומות, דירוג תוכן, קהל יעד, Data safety, ושאלות על אפליקציות ממשלתיות, פיננסיות, בריאות וחדשות.

אחר כך **Store listing**: השם, התיאור הקצר, התיאור המלא, הסמל `icon-512.png`, התמונה הראשית `feature-graphic.png`, וצילומי המסך מ-`store/screenshots` לפי הסדר.

### 5. גרסה ראשונה לבדיקה פנימית

**Test and release → Testing → Internal testing → Create new release**:
- כש-Play שואל על חתימת האפליקציה, משאירים את ברירת המחדל: **Google יוצר ושומר את מפתח החתימה** (Play App Signing).
- מעלים את `app-release.aab`, ומוסיפים את עצמך כבודק (רשימת אימיילים).

### 6. חיבור האתר לאפליקציה (assetlinks.json)

אחרי ההעלאה הראשונה: **Test and release → App integrity → App signing**. שם יש שתי טביעות אצבע SHA-256:
- **App signing key certificate** – המפתח ש-Google חותם בו את האפליקציה שמגיעה לטלפונים.
- **Upload key certificate** – המפתח שלך משלב 1.

שלח לי את שתיהן ואעלה את הקובץ לאתר `guymaslawi.github.io` (באישורך, כי זה שינוי באתר האישי שלך). מי שמעדיף לעשות זאת לבד: זה הקובץ, בנתיב `.well-known/assetlinks.json` במאגר `guymaslawi.github.io`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "io.github.guymaslawi.salhacham",
      "sha256_cert_fingerprints": ["<App signing key SHA-256>", "<Upload key SHA-256>"]
    }
  }
]
```

### 7. בדיקה בטלפון

מתקינים מהקישור של הבדיקה הפנימית. אם האפליקציה נפתחת **בלי שורת כתובת** למעלה, הכול מחובר. אם יש שורת כתובת, קובץ assetlinks.json חסר או שטביעות האצבע לא תואמות.

### 8. בדיקה סגורה (רק אם Play דורש)

בחשבונות אישיים חדשים יחסית Google מבקש בדיקה סגורה עם **לפחות 12 בודקים, במשך 14 ימים ברציפות**, לפני שאפשר להגיש לכולם. Play Console יציג את הדרישה הזו אם היא חלה עליך. מספיקים חברים ובני משפחה עם Android שמצטרפים דרך קישור.

### 9. הגשה לכולם

**Production → Create new release** עם אותו קובץ, ושליחה לבדיקה. הבדיקה של Google לוקחת בדרך כלל כמה ימים.

## עדכונים בעתיד

- **שינוי באתר:** דוחפים ל-GitHub כרגיל, ומשתמשי Play רואים אותו מיד.
- **שינוי בשם, בסמל או בצבעים:** מעלים ב-1 את `versionCode` ב-`android/app/build.gradle`, מריצים `./build-release.sh`, ומעלים ל-Play.
- **צילומי מסך חדשים:** `node scripts/store-assets.mjs`.
