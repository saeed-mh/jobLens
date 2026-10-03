# Job Lens — مرحلهٔ ۱

این مرحله فقط نصب یک افزونهٔ ساده با Manifest V3، پنجرهٔ کوچک (Popup) و صفحهٔ تنظیمات را تمرین می‌کند. آپلود رزومه، تحلیل LinkedIn و بک‌اند هنوز پیاده‌سازی نشده‌اند.

## مفاهیم و فایل‌ها

- `src/manifest.json`: شناسنامهٔ افزونه؛ نام، نسخه، پنجرهٔ کوچک و صفحهٔ تنظیمات را معرفی می‌کند.
- `src/popup/popup.html`: ساختار پنجره‌ای که با کلیک روی آیکون افزونه باز می‌شود.
- `src/popup/popup.ts`: نمایش نسخه و بازکردن صفحهٔ تنظیمات با `chrome.runtime.openOptionsPage()`.
- `src/options/options.html`: صفحهٔ اولیهٔ تنظیمات؛ در مرحلهٔ بعد آپلود رزومه و ترجیحات اینجا اضافه می‌شوند.
- `src/styles.css`: ظاهر مشترک دو صفحه.
- `tsconfig.json`: تنظیمات بررسی و تبدیل TypeScript به JavaScript. Chrome فایل TypeScript را مستقیم اجرا نمی‌کند.
- `package.json`: ابزارهای توسعه و دستورهای ساخت.
- `package-lock.json`: ثبت نسخه‌های دقیق وابستگی‌ها برای نصب تکرارپذیر.
- `scripts/build.mjs`: تبدیل TypeScript و کپی فایل‌های HTML، CSS و manifest به `dist`.
- `.gitignore`: جلوگیری از ثبت خروجی ساخت، وابستگی‌ها و فایل‌های متداول حاوی secrets در Git.
- `dist/`: خروجی قابل نصب؛ این پوشه را به Chrome معرفی کن و فایل‌هایش را مستقیم ویرایش نکن.

در مراحل بعد، Content script داخل صفحهٔ LinkedIn اجرا می‌شود. Service worker مسئول کارهای پس‌زمینهٔ افزونه خواهد بود و دائماً فعال نمی‌ماند. فعلاً به هیچ‌کدام نیاز نداریم.

`typescript` ابزار تبدیل کد است و `chrome-types` تعریف نوع APIهای Chrome را فراهم می‌کند. این ابزارها وابستگی توسعه هستند و کد اجرایی از CDN بارگذاری نمی‌شود. مرحلهٔ اول هیچ مجوز دسترسی به سایت‌ها، اطلاعات تب‌ها یا ذخیره‌سازی درخواست نمی‌کند و هیچ داده‌ای را ارسال نمی‌کند.

## ساخت در ویندوز

به Node.js نسخهٔ ۲۲ یا بالاتر و Chrome به‌روز نیاز داری. در PowerShell اجرا کن:

```powershell
Set-Location 'D:\Projects\Job Lens'
node --version
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
```

`npm.cmd ci` وابستگی‌ها را مطابق فایل قفل نصب می‌کند. از `npm.cmd` استفاده می‌کنیم چون ممکن است PowerShell اجرای `npm.ps1` را مسدود کند. نیازی به تغییر Execution Policy نیست.

در پایان باید پیام زیر را ببینی:

```text
Build complete. Load the dist folder in chrome://extensions.
```

## نصب در Chrome

1. در نوار آدرس Chrome بنویس `chrome://extensions`.
2. گزینهٔ **Developer mode** را روشن کن.
3. روی **Load unpacked** کلیک کن.
4. پوشهٔ `D:\Projects\Job Lens\dist` را انتخاب کن؛ پوشهٔ اصلی پروژه یا `src` را انتخاب نکن.
5. کارت **Job Lens** باید ظاهر شود و روشن باشد.
6. روی آیکون پازل کنار نوار آدرس کلیک کن و Job Lens را Pin کن.

## تست دستی

1. روی آیکون Job Lens کلیک کن. باید `Extension is ready` و `Version 0.1.0` را ببینی. نمایش نسخه نشان می‌دهد JavaScript ساخته‌شده و API افزونه اجرا شده‌اند.
2. روی **Open settings** کلیک کن. باید یک تب با عنوان `Job Lens — Settings` باز شود و متن `Settings page is ready` را ببینی.
3. آدرس صفحهٔ تنظیمات باید با `chrome-extension://` شروع شود.
4. پنجرهٔ کوچک را دوباره باز کن و دوباره **Open settings** را بزن؛ Chrome باید صفحهٔ تنظیمات افزونه را باز کند یا به صفحهٔ بازشده برگردد.
5. در `chrome://extensions` خطاهای کارت افزونه را بررسی کن. برای دیدن Console پنجرهٔ کوچک، داخل آن راست‌کلیک کن و **Inspect** را بزن. صفحهٔ تنظیمات را هم با DevTools بررسی کن؛ نباید خطای JavaScript وجود داشته باشد.

در این مرحله صفحهٔ LinkedIn تغییری نمی‌کند و امتیازی نمایش داده نمی‌شود.

## تغییر کد و ساخت دوباره

فایل‌ها را در `src` تغییر بده، سپس اجرا کن:

```powershell
npm.cmd run build
```

در `chrome://extensions` دکمهٔ Reload کارت Job Lens را بزن؛ بعد پنجرهٔ کوچک را دوباره باز کن و تب تنظیمات را Refresh کن.

## خطاهای معمول

- **Manifest file is missing or unreadable**: ابتدا build را اجرا کن و پوشهٔ `dist` را انتخاب کن؛ فایل `dist/manifest.json` باید وجود داشته باشد.
- **Could not load JavaScript / Could not load popup**: build را دوباره اجرا کن، موفقیت آن را بررسی کن و افزونه را Reload کن.
- **نسخه به‌جای عدد، خط تیره است یا دکمه کار نمی‌کند**: Console پنجرهٔ کوچک را بررسی کن. HTML را مستقیم با `file://` باز نکن؛ باید از آیکون افزونه اجرا شود.
- **npm.ps1 cannot be loaded**: دستورها را با `npm.cmd` اجرا کن.
- **node یا npm.cmd شناخته نمی‌شود**: Node.js را نصب کن و ترمینال را دوباره باز کن.
- **خطای دریافت بسته‌ها**: اتصال اینترنت و دسترسی به npm registry را بررسی کن؛ نصب وابستگی‌ها اینترنت می‌خواهد.
- **تغییرات دیده نمی‌شوند**: فایل‌های `src` را تغییر بده، build را اجرا کن، افزونه را Reload کن و صفحه‌های بازشده را تازه کن.
- **Load unpacked وجود ندارد**: Developer mode را روشن کن. مرورگر مدیریت‌شدهٔ سازمانی ممکن است نصب افزونهٔ محلی را محدود کند.

## مستندات رسمی بررسی‌شده

- [ساخت و نصب محلی افزونه](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [صفحهٔ تنظیمات](https://developer.chrome.com/docs/extensions/develop/ui/options-page)
- [Runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- [سیاست امنیتی Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [تنظیمات TypeScript](https://www.typescriptlang.org/tsconfig/)

ساختار API مدل، سازگاری کتابخانه‌های استخراج فایل و محدودیت‌های رایگان Cloudflare پیش از مراحل مربوط به آن‌ها بررسی خواهند شد. در این مرحله مدل یا کتابخانهٔ استخراج فایل انتخاب نشده است.

پس از تست، نتیجهٔ نصب، بازشدن پنجرهٔ کوچک و بازشدن تنظیمات را گزارش کن. مرحلهٔ بعد فقط با گزارش تو یا درخواست «ادامه بده» شروع می‌شود.
