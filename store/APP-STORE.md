# העלאת סל חכם ל-App Store

**אפשר להתחיל רק אחרי ש-Apple מאשרים את חשבון המפתח.** עד אז אין צורך לעשות כלום; האפליקציה כבר נבנית ורצה בסימולטור.

## איך האפליקציה בנויה

אותו קוד של האתר, ארוז בתוך אפליקציה אמיתית (Capacitor):
- קובצי האפליקציה נמצאים בתוך האפליקציה, כך שהיא נפתחת מיד וגם בלי קליטה. המחירים יורדים מהאתר כל יום, כמו היום.
- שיתוף, מיקום ורטט הם של iPhone עצמו: חלון השיתוף של iOS, בקשת מיקום אחת בשם האפליקציה, ורטט קל בסימון מוצר בעגלה.
- המקלדת לא מסתירה חלונות עם שדה טקסט.
- iPhone בלבד, לאורך, מ-iOS 16.4 (הגרסה הראשונה שיודעת לפתוח את קובצי המחירים).
- בקשות ההרשאה (מצלמה, מיקום) בעברית ואומרות בדיוק מה שכתוב במדיניות הפרטיות.

**הבדל חשוב מ-Google Play:** שם כל שינוי באתר מגיע מיד. ב-iPhone, שינוי בעיצוב או בהתנהגות של האפליקציה דורש להעלות גרסה חדשה. מחירים ומבצעים מתעדכנים כל יום בלי שום העלאה.

## השלבים

### 1. פתיחת הפרויקט ב-Xcode

```bash
npm run ios && npx cap open ios
```

`npm run ios` בונה את האפליקציה ומעתיק אותה לפרויקט ה-iPhone. צריך להריץ אותו אחרי כל שינוי בקוד.

### 2. חתימה

ב-Xcode: **App** (בצד) → **Signing & Capabilities** → **Team**: בוחרים את החשבון שלך. החתימה האוטומטית תרשום את מזהה האפליקציה `io.github.guymaslawi.salhacham`.

### 3. יצירת האפליקציה ב-App Store Connect

https://appstoreconnect.apple.com → **Apps** → **+** → **New App**:
- Platform: **iOS**
- Name: `סל חכם – השוואת מחירי סופר`
- Primary language: **Hebrew**
- Bundle ID: `io.github.guymaslawi.salhacham`
- SKU: `sal-hacham-ios`

### 4. העלאת גרסה

ב-Xcode: יעד **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App** → **App Store Connect** → **Upload**.

לכל העלאה חדשה מעלים ב-1 את **Build** (ב-**General** של App). את **Version** (כרגע 1.0.0) מעלים כשמשחררים גרסה חדשה לציבור.

### 5. בדיקה ב-TestFlight

התקן מ-TestFlight על ה-iPhone שלך, ובדוק את מה שהסימולטור לא יכול לבדוק: **סריקת ברקוד במצלמה**, ומיקום אמיתי ב"מצא סופרים לידי".

### 6. דף האפליקציה

ממלאים לפי הטקסטים שלמטה. צילומי המסך נמצאים ב-`store/app-store/` (1320×2868, מתאים ל-iPhone בגודל 6.9 אינץ', ו-Apple מקטינה אותם לשאר הגדלים).

### 7. הגשה לבדיקה

**Add for Review**. מוסיפים את ההערות לבודק מלמטה. הבדיקה לוקחת בדרך כלל יום עד שלושה.

## טקסטים להעתקה

| שדה | ערך | מגבלה |
| --- | --- | --- |
| Name | `סל חכם – השוואת מחירי סופר` | 26/30 |
| Subtitle | `איפה הסל שלך הכי זול היום` | 25/30 |
| Keywords | `סופר,מחירים,השוואת מחירים,רשימת קניות,מבצעים,סל קניות,זול,מכולת,שקיפות מחירים,חיסכון,ברקוד` | 90/100 |
| Primary category | Shopping | |
| Secondary category | Food & Drink | |
| Support URL | https://github.com/GuyMaslawi/sal-hacham/issues | |
| Marketing URL | https://guymaslawi.github.io/sal-hacham/ | |
| Privacy Policy URL | https://guymaslawi.github.io/sal-hacham/privacy.html | |
| Price | Free | |

במילות המפתח בכוונה אין שמות של רשתות: Apple דוחה מילות מפתח עם סימנים מסחריים של אחרים. בתיאור מותר להזכיר אותן, כי זה תיאור עובדתי של מה שהאפליקציה משווה.

**Promotional text** (119/170):

```
משווים את רשימת הקניות בין 29 רשתות וכ-1,900 סניפים, לפי המחירים והמבצעים שהרשתות מפרסמות היום. בלי הרשמה ובלי פרסומות.
```

**Description**: התיאור המלא מ-`store/listing.md`, אותו טקסט כמו ב-Google Play.

**App Privacy**: **Data Not Collected**. האפליקציה לא אוספת שום מידע, וזה גם מה שכתוב בקובץ הפרטיות שבתוך האפליקציה (`PrivacyInfo.xcprivacy`).

**Age Rating**: לכל השאלות **None** או **No**. התוצאה: 4+.

**App Review notes** (באנגלית, כי הבודקים קוראים אנגלית):

```
Sal Hacham compares a shopping list across Israeli supermarket branches, using the price files every chain is required by law to publish daily (Israel's Price Transparency Law). The app is in Hebrew.

No account or login is needed. To try it: tap "בחר עיר" (Choose city), pick "תל אביב - יפו", tap the yellow "המשך" button, then add products from the quick-start buttons (for example "חלב") and open the "השוואה" (Compare) tab to see the basket total in every branch.

Native features: the system share sheet for sharing the list, location (used only on the device to suggest nearby branches, never sent anywhere), haptic feedback while shopping, barcode scanning with the camera, and offline use: the app and the chosen branches' prices are stored on the device.

The app collects no data and has no ads, analytics or tracking.
```

**Copyright**: `2026` ושמך, כפי שיופיע בחשבון המפתח.
