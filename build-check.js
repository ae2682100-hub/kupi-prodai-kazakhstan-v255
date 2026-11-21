'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const required = [
  'PHONE_SETUP_RU.txt', 'PROJECT_MAP_RU.txt', 'README_RU.txt', 'docs/AUDIT_RU.txt',
  'site/index.html', 'site/home.html', 'site/ad-form.html', 'site/free-issue.html',
  'site/search-issue.html', 'site/admin.html', 'site/manifest.webmanifest', 'site/sw.js', 'site/icon-app.svg', 'site/icon-admin.svg', 'site/icon-192.png', 'site/icon-512.png', 'site/admin-icon-192.png', 'site/site-qr.png',
  'netlify/functions/api.js', 'netlify/functions/issue-ads.js',
  'apps_script/Code.gs', 'apps_script/Database.gs', 'apps_script/Ads.gs',
  'apps_script/IssuesPayments.gs', 'apps_script/Admin.gs', 'apps_script/appsscript.json',
  'netlify.toml', 'package.json', 'scripts/build-check.js'
];
function fail(message) { throw new Error(message); }
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail('Не найден обязательный файл: ' + file);
  if (!fs.statSync(full).isFile() || fs.statSync(full).size < 20) fail('Файл отсутствует или пустой: ' + file);
}
// Compile every server-side JavaScript file without executing it.
for (const file of [
  'netlify/functions/api.js', 'netlify/functions/issue-ads.js',
  'apps_script/Code.gs', 'apps_script/Database.gs', 'apps_script/Ads.gs',
  'apps_script/IssuesPayments.gs', 'apps_script/Admin.gs'
]) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
// Verify that the home-page navigation targets exist and are local sibling pages.
const indexHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
for (const target of ['./ad-form.html', './free-issue.html']) {
  if (!indexHtml.includes('href=\"' + target + '\"')) fail('На главной странице отсутствует ссылка: ' + target);
  if (!fs.existsSync(path.join(root, 'site', target.replace(/^\.\//, '')))) fail('Не найдена целевая страница: ' + target);
}
const homeHtml = fs.readFileSync(path.join(root, 'site/home.html'), 'utf8');
if (!homeHtml.includes('./index.html') || !homeHtml.includes('location.replace')) fail('home.html должен перенаправлять на основную страницу index.html.');
// Compile every inline browser script in all six pages.
const pages = ['index.html','home.html','ad-form.html','free-issue.html','search-issue.html','admin.html'];
for (const file of pages) {
  const html = fs.readFileSync(path.join(root, 'site', file), 'utf8');
  if (!/^<!doctype html>/i.test(html.trim())) fail('Некорректное начало HTML: site/' + file);
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (let i = 0; i < blocks.length; i++) {
    const attrs = blocks[i][1];
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']application\/json/i.test(attrs)) continue;
    new vm.Script(blocks[i][2], { filename: file + ':inline-script-' + (i + 1) });
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.scripts?.build !== 'node scripts/build-check.js') fail('Неверная команда сборки package.json.');
if (Number(pkg.engines?.node?.replace(/\D/g, '') || 0) < 18) fail('Для Netlify требуется Node.js 18 или новее.');
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
for (const line of ['command = "npm run build"', 'publish = "site"', 'functions = "netlify/functions"', 'node_bundler = "esbuild"']) {
  if (!toml.includes(line)) fail('В netlify.toml отсутствует настройка: ' + line);
}
const gas = fs.readFileSync(path.join(root, 'apps_script/Code.gs'), 'utf8');
const db = fs.readFileSync(path.join(root, 'apps_script/Database.gs'), 'utf8');
if (/INTERNAL_API_SECRET\s*=/.test(gas) || /setProperty\(['"]KUPI_API_SECRET['"]/.test(db)) fail('Найдено небезопасное встраивание/перезапись API-ключа.');
if (!/getProperty\(['"]KUPI_API_SECRET['"]\)/.test(gas)) fail('Нет проверки сохранённого API-ключа Apps Script.');
const actions = [...gas.matchAll(/case\s+'([^']+)'\s*:/g)].map(m => m[1]);
for (const action of ['formData','submitAd','uploadPhoto','searchAds','currentIssue','issueAds','purchaseRequest','feedback','publicNotice','adminSaveNotice','adminStart','adminVerify','adminDashboard','adminDecision','adminFeedback','adminGrant','adminMarkLinkSent','adminCreateIssue','adminLogout']) {
  if (!actions.includes(action)) fail('В API Apps Script отсутствует действие: ' + action);
}
const api = fs.readFileSync(path.join(root, 'netlify/functions/api.js'), 'utf8');
if (!/exports\.handler\s*=\s*async/.test(api)) fail('Не найден обработчик Netlify Function api.');
if (!/process\.env\.KUPI_API_SECRET/.test(api)) fail('API не читает KUPI_API_SECRET из переменных Netlify.');
if (!/DEFAULT_GAS_URL/.test(api)) fail('Не задан резервный URL Apps Script.');
const issueFn = fs.readFileSync(path.join(root, 'netlify/functions/issue-ads.js'), 'utf8');
if (!/require\(['"]\.\/api['"]\)/.test(issueFn) || !/api\.handler/.test(issueFn)) fail('Endpoint issue-ads не подключён к API gateway.');
const paidPage = fs.readFileSync(path.join(root, 'site/search-issue.html'), 'utf8');
const freePage = fs.readFileSync(path.join(root, 'site/free-issue.html'), 'utf8');
if (/htmlBtn|pdfBtn|exportIssueHtml|printIssuePdf/.test(paidPage)) fail('В полном платном выпуске осталась функция скачивания или печати.');
if (!/htmlBtn/.test(freePage) || !/pdfBtn/.test(freePage)) fail('Кнопки бесплатного выпуска должны оставаться без изменений.');
if (!/kupi_paid_device_v1/.test(paidPage) || !/device_id/.test(paidPage)) fail('В платном выпуске не создаётся и не передаётся идентификатор браузера.');
const payments = fs.readFileSync(path.join(root, 'apps_script/IssuesPayments.gs'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'apps_script/Admin.gs'), 'utf8');
if (!/validAccess_\(p\.token,issue\.issue_id,p\.device_id\)/.test(payments) || !/access_device_id/.test(admin)) fail('Серверная привязка платной ссылки к первому браузеру не настроена.');
if (!/access_device_id/.test(gas) || !/if\(last<headers\.length\)/.test(db)) fail('Не настроено безопасное добавление столбца привязки устройства в таблицу платежей.');
for (const page of ['site/index.html','site/free-issue.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  if (!html.includes('Сначала переведите 500 ₸') || !html.includes('Я оплатил(а)')) fail('На странице покупки неверный порядок оплаты и отправки заявки: ' + page);
}
// Exercise the one-time browser binding with an in-memory payment sheet.
const headers = ['request_id','issue_id','status','access_token','access_expires_at','access_device_id'];
const rows = [headers, ['r1','i1','paid','token-test',new Date(Date.now()+60000),'']];
const fakeSheet = {
  getDataRange(){ return { getValues(){ return rows; } }; },
  getRange(r,c){ return { setValue(v){ rows[r-1][c-1]=v; } }; }
};
const accessContext = { LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } }, sheet_(){ return fakeSheet; } };
vm.createContext(accessContext);
vm.runInContext(admin, accessContext, {filename:'Admin.gs:device-binding-test'});
const deviceA = 'a'.repeat(48), deviceB = 'b'.repeat(48);
const firstOpen = accessContext.validAccess_('token-test','i1',deviceA);
const sameBrowser = accessContext.validAccess_('token-test','i1',deviceA);
const otherBrowser = accessContext.validAccess_('token-test','i1',deviceB);
if (!firstOpen || !sameBrowser || otherBrowser || rows[1][5] !== deviceA || rows[1][2] !== 'activated') fail('Проверка привязки ссылки к первому браузеру не пройдена.');
const sendRows = [
  ['request_id','status','access_expires_at','access_token','link_sent_at'],
  ['req-send','paid',new Date(Date.now()+60000),'private-token','']
];
const sendSheet = {
  getDataRange(){ return { getValues(){ return sendRows; } }; },
  getRange(r,c){ return { setValue(v){ sendRows[r-1][c-1]=v; } }; }
};
const sendContext = { LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } }, sheet_(){ return sendSheet; } };
vm.createContext(sendContext); vm.runInContext(admin, sendContext, {filename:'Admin.gs:one-time-send-test'});
const marked = sendContext.adminMarkLinkSent_({request_id:'req-send'});
let duplicateBlocked = false;
try { sendContext.adminMarkLinkSent_({request_id:'req-send'}); } catch (_) { duplicateBlocked = true; }
if (marked.status !== 'link_sent' || sendRows[1][1] !== 'link_sent' || !sendRows[1][4] || !duplicateBlocked) fail('Повторная отправка WhatsApp не блокируется.');
const adminPage = fs.readFileSync(path.join(root, 'site/admin.html'), 'utf8');
if (!adminPage.includes('data-copy-link') || !adminPage.includes('data-copy-phone') || !adminPage.includes('data-sent')) fail('В админке отсутствуют ручное копирование и отметка отправки ссылки.');
if (!adminPage.includes('adminMarkLinkSent') || !adminPage.includes('WhatsApp')) fail('В админке не настроена ручная отметка отправки ссылки.');
if (!adminPage.includes('+85294900674') || !adminPage.includes('p.phone')) fail('В админке не указан редакционный номер или телефон покупателя.');
if (!adminPage.includes('PAYMENT_RECEIVED') || !/p\.confirmation !== 'PAYMENT_RECEIVED'/.test(admin)) fail('В админке/сервере отсутствует дополнительная проверка перед подтверждением оплаты.');
if (!admin.includes("'&personal=1'") || !adminPage.includes('Персональная ссылка для покупателя')) fail('Персональная ссылка не помечена как персональная.');
const indexPage = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
if (!indexPage.includes('max-height:calc(100dvh - 32px)') || !indexPage.includes('beforeinstallprompt') || !indexPage.includes('/sw.js') || !indexPage.includes('/site-qr.png')) fail('Не настроены мобильная прокрутка окна покупки или установка PWA.');
const freeIssuePage = fs.readFileSync(path.join(root, 'site/free-issue.html'), 'utf8');
if (!freeIssuePage.includes('max-height:calc(100dvh - 36px)') || !freeIssuePage.includes('Отправляем заявку…') || !freeIssuePage.includes('issueMeta?.issue_id')) fail('Форма покупки на странице бесплатного выпуска не адаптирована для мобильного экрана.');
const adPage = fs.readFileSync(path.join(root, 'site/ad-form.html'), 'utf8');
if (!adPage.includes('cameraPhotos') || !adPage.includes('accept=\"image/*\"') || !adPage.includes('createImageBitmap')) fail('Не настроен выбор фото из галереи/камеры или сжатие изображений.');
if (!/if\(full&&current&&String\(issue\.issue_id\)!==String\(current\.issue_id\)\)/.test(payments)) fail('Платная ссылка не ограничена текущим выпуском.');
// Verify that setupProject appends the new column without replacing old payment data.
const oldPaymentHeaders = ['request_id','created_at','issue_id','issue_number','buyer_name','buyer_email','buyer_phone','amount','status','payment_reference','admin_note','access_token','access_expires_at','granted_at'];
let migratedHeaders = oldPaymentHeaders.slice();
const migrationSheet = {
  getLastRow(){ return 2; },
  getLastColumn(){ return migratedHeaders.length; },
  getRange(r,c,n,m){ return { getDisplayValues(){ return [migratedHeaders.slice(c-1,c-1+m)]; }, setValues(v){ migratedHeaders.splice(c-1,v[0].length,...v[0]); } }; },
  setFrozenRows(){}
};
const dbContext = {}; vm.createContext(dbContext); vm.runInContext(db, dbContext, {filename:'Database.gs:migration-test'});
dbContext.ensureSupportSheet_({getSheetByName(){return migrationSheet;},insertSheet(){return migrationSheet;}},'Платежи',oldPaymentHeaders.concat('access_device_id','link_sent_at'));
if (migratedHeaders[migratedHeaders.length-2] !== 'access_device_id' || migratedHeaders[migratedHeaders.length-1] !== 'link_sent_at') fail('Миграция столбца access_device_id не прошла.');
console.log('BUILD CHECK OK');
console.log('Полный проект с сохранённой структурой каталогов проверен.');
console.log('Проверено: обязательные файлы проекта, PWA-манифест/иконки/Service Worker, шесть HTML-страниц, маршруты, синтаксис серверных и браузерных скриптов, 19 API-действий, защита секрета, запрет скачивания платного выпуска, порядок оплаты и тест привязки ссылки к первому браузеру с миграцией таблицы.');
console.log('Важно: живые Google/Netlify интеграции этим локальным тестом не проверяются.');
