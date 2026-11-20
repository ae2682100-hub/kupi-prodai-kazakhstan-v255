// Административная часть API «Купи-Продай — Казахстан».
// Разрешённый адрес входа задаётся здесь отдельно от CFG.
const ADMIN_LOGIN_EMAIL_ = 'veeelts139@gmail.com';

function adminStart_(p) {
  const email = String(p.email || '').trim().toLowerCase();

  if (email !== ADMIN_LOGIN_EMAIL_.toLowerCase()) {
    throw new Error('Этот адрес не имеет доступа к редакторской панели.');
  }

  const cache = CacheService.getScriptCache();
  if (cache.get('OTP_WAIT_' + email)) {
    throw new Error('Подождите минуту перед повторным запросом кода.');
  }

  cache.put('OTP_WAIT_' + email, '1', 60);

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('OTP_' + email, otp, 600);
  cache.put('OTP_FAIL_' + email, '0', 600);

  MailApp.sendEmail(
    email,
    'Код входа — Купи-Продай Казахстан',
    'Ваш одноразовый код: ' + otp +
      '\nДействует 10 минут. Если вы не запрашивали вход, проигнорируйте письмо.'
  );

  return { message: 'Код отправлен на разрешённый адрес редакции.' };
}

function adminVerify_(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const otp = cache.get('OTP_' + email);

  if (email !== ADMIN_LOGIN_EMAIL_.toLowerCase() || !otp) {
    throw new Error('Неверный или просроченный код.');
  }

  if (otp !== String(p.code || '')) {
    const fails = Number(cache.get('OTP_FAIL_' + email) || 0) + 1;
    cache.put('OTP_FAIL_' + email, String(fails), 600);

    if (fails >= 5) {
      cache.remove('OTP_' + email);
      cache.remove('OTP_FAIL_' + email);
    }

    throw new Error(
      fails >= 5
        ? 'Слишком много попыток. Запросите новый код позже.'
        : 'Неверный код. Осталось попыток: ' + (5 - fails)
    );
  }

  cache.remove('OTP_' + email);
  cache.remove('OTP_FAIL_' + email);

  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('ADM_' + token, email, 21600);

  return { session: token, email: email, expires_in: 21600 };
}

function requireAdmin_(token) {
  const email = CacheService.getScriptCache().get('ADM_' + String(token || ''));

  if (!email || email.toLowerCase() !== ADMIN_LOGIN_EMAIL_.toLowerCase()) {
    throw new Error('Сеанс редактора истёк. Войдите снова.');
  }

  return email;
}

function adminDashboard_() {
  return {
    notice: adminNoticeData_(),
    ads: rows_(CFG.SHEETS.ads)
      .filter(a => ['pending', 'review'].includes(a.status))
      .map(a => ({
        id: a.ad_id,
        title: a.title,
        description: a.description,
        price: a.price,
        price_condition: a.price_condition,
        kind: a.kind,
        category: a.category,
        region: a.region,
        city: a.city,
        contact_name: a.contact_name,
        phone: a.phone,
        language: a.language_submitted,
        created_at: formatDate_(a.created_at),
        status: a.status,
        photo_urls: parseJson_(a.photo_urls, [])
      })),

    purchases: rows_('Платежи')
      .filter(p => ['pending', 'paid', 'link_sent', 'activated'].includes(p.status))
      .slice(-200).reverse()
      .map(p => ({
        request_id: p.request_id,
        name: p.buyer_name,
        phone: p.buyer_phone,
        issue_id: p.issue_id,
        issue_label: p.issue_number,
        status: p.status,
        amount: p.amount,
        created_at: formatDate_(p.created_at),
        access_path: p.status === 'paid' && p.access_token && p.access_expires_at && new Date(p.access_expires_at) > new Date()
          ? 'search-issue.html?token=' + encodeURIComponent(p.access_token) + '&issue_id=' + encodeURIComponent(p.issue_id)
          : ''
      })),

    feedback: rows_('Отзывы')
      .filter(f => ['new', 'read', 'done'].includes(f.status))
      .slice(-200).reverse()
      .map(f => ({
        feedback_id: f.feedback_id,
        created_at: formatDate_(f.created_at),
        name: f.name,
        contact: f.contact,
        kind: f.kind,
        message: f.message,
        status: f.status
      })),

    issues: rows_('Выпуски').slice(-10).reverse().map(i => ({
      issue_id: i.issue_id,
      is_current: !!(currentIssueRow_() && String(currentIssueRow_().issue_id) === String(i.issue_id)),
      issue_number: i.issue_number,
      issue_date: formatDate_(i.issue_date),
      status: i.status,
      ad_count: i.ad_count
    }))
  };
}

function adminFeedback_(p) {
  const allowed = ['read', 'done'];
  if (allowed.indexOf(p.status) < 0) throw new Error('Недопустимый статус обращения.');

  const sh = sheet_('Отзывы');
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const idc = h.indexOf('feedback_id');
  const sc = h.indexOf('status');
  if (idc < 0 || sc < 0) throw new Error('В листе отзывов отсутствуют обязательные столбцы.');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idc]) === String(p.feedback_id)) {
      sh.getRange(i + 1, sc + 1).setValue(p.status);
      return { feedback_id: p.feedback_id, status: p.status };
    }
  }
  throw new Error('Обращение не найдено.');
}

function adminMarkLinkSent_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Платежи');
    const data = sh.getDataRange().getValues();
    const h = data[0];
    const idCol = h.indexOf('request_id');
    const statusCol = h.indexOf('status');
    const expiryCol = h.indexOf('access_expires_at');
    const tokenCol = h.indexOf('access_token');
    if ([idCol, statusCol, expiryCol, tokenCol].some(x => x < 0)) throw new Error('В листе платежей отсутствуют обязательные столбцы.');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) !== String(p.request_id)) continue;
      if (data[i][statusCol] !== 'paid' || !data[i][tokenCol]) throw new Error('Ссылка уже отправлена или заявка ещё не оплачена. Повторная отправка запрещена.');
      if (!data[i][expiryCol] || new Date(data[i][expiryCol]) <= new Date()) throw new Error('Срок действия ссылки уже истёк.');
      sh.getRange(i + 1, statusCol + 1).setValue('link_sent');
      return { request_id: p.request_id, status: 'link_sent' };
    }
    throw new Error('Заявка на покупку не найдена.');
  } finally {
    lock.releaseLock();
  }
}

function adminDecision_(p) {
  const allowed = ['approve', 'reject', 'review'];
  if (allowed.indexOf(p.decision) < 0) {
    throw new Error('Недопустимое решение.');
  }

  const sh = sheet_(CFG.SHEETS.ads);
  const data = sh.getDataRange().getValues();
  const h = data[0];

  const idc = h.indexOf('ad_id');
  const sc = h.indexOf('status');
  const uc = h.indexOf('updated_at');
  const mc = h.indexOf('moderated_by');
  const mt = h.indexOf('moderated_at');
  const rc = h.indexOf('rejection_reason');
  const nc = h.indexOf('moderator_note');
  const pc = h.indexOf('published_at');

  let row = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idc]) === String(p.ad_id)) {
      row = i + 1;
      break;
    }
  }

  if (row < 0) throw new Error('Объявление не найдено.');

  const status = p.decision === 'approve'
    ? 'approved'
    : p.decision === 'reject'
      ? 'rejected'
      : 'review';

  sh.getRange(row, sc + 1).setValue(status);
  sh.getRange(row, uc + 1).setValue(new Date());
  sh.getRange(row, mc + 1).setValue(ADMIN_LOGIN_EMAIL_);
  sh.getRange(row, mt + 1).setValue(new Date());
  sh.getRange(row, rc + 1).setValue(
    p.decision === 'reject' ? (p.reason || 'Отклонено редакцией') : ''
  );
  sh.getRange(row, nc + 1).setValue(p.note || '');

  if (status === 'approved') {
    sh.getRange(row, pc + 1).setValue(new Date());
  }

  return { ad_id: p.ad_id, status: status };
}

function adminGrant_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Платежи');
    const data = sh.getDataRange().getValues();
    const h = data[0];
    const requestCol = h.indexOf('request_id');
    const statusCol = h.indexOf('status');
    if (requestCol < 0 || statusCol < 0) throw new Error('В листе платежей отсутствуют обязательные столбцы.');

    let row = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][requestCol]) === String(p.request_id)) {
        row = i + 1;
        break;
      }
    }

    if (row < 0) throw new Error('Запрос оплаты не найден.');
    const currentStatus = String(sh.getRange(row, statusCol + 1).getValue() || '');
    if (currentStatus !== 'pending') {
      throw new Error('Эта заявка уже обработана. Повторное создание ссылки запрещено.');
    }

    const issueId = sh.getRange(row, h.indexOf('issue_id') + 1).getValue();
    const currentIssue = currentIssueRow_();
    if (!currentIssue || String(currentIssue.issue_id) !== String(issueId)) {
      throw new Error('Эта заявка относится не к последнему выпуску. Доступ для неё не создаётся.');
    }

    const token = Utilities.getUuid() + Utilities.getUuid();
    const exp = nextIssueBoundary_();
    const updates = [
      ['admin_note', p.note || 'Оплата проверена редактором вручную'],
      ['access_token', token],
      ['access_expires_at', exp],
      ['granted_at', new Date()],
      ['status', 'paid']
    ];
    updates.forEach(([key]) => {
      if (h.indexOf(key) < 0) throw new Error('В листе платежей отсутствует столбец ' + key + '.');
    });
    updates.forEach(([key, value]) => sh.getRange(row, h.indexOf(key) + 1).setValue(value));

    const base = PropertiesService.getScriptProperties().getProperty('SITE_BASE_URL') || '';
    return {
      status: 'paid',
      message: 'Оплата подтверждена. Персональная ссылка создана; отправка WhatsApp будет подключена отдельным этапом.',
      access_url: base
        ? base + '/search-issue.html?token=' + encodeURIComponent(token) +
          '&issue_id=' + encodeURIComponent(issueId)
        : 'search-issue.html?token=' + token + '&issue_id=' + encodeURIComponent(issueId),
      expires_at: exp.toISOString(),
      issue_id: issueId
    };
  } finally {
    lock.releaseLock();
  }
}

function nextIssueBoundary_() {
  const now = new Date();
  const day = Number(Utilities.formatDate(now, CFG.TIMEZONE, 'u'));
  let add = (8 - day) % 7;
  if (add === 0) {
    const hour = Number(Utilities.formatDate(now, CFG.TIMEZONE, 'HH'));
    if (hour >= 6) add = 7;
  }

  const date = new Date(now.getTime() + add * 24 * 60 * 60 * 1000);
  const year = Number(Utilities.formatDate(date, CFG.TIMEZONE, 'yyyy'));
  const month = Number(Utilities.formatDate(date, CFG.TIMEZONE, 'MM')) - 1;
  const dayOfMonth = Number(Utilities.formatDate(date, CFG.TIMEZONE, 'dd'));

  return new Date(Date.UTC(year, month, dayOfMonth, 1, 0, 0));
}

function validAccess_(token, issueId, deviceId) {
  const id = String(deviceId || '').trim();
  if (!/^[a-f0-9]{48}$/i.test(id)) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Платежи');
    const data = sh.getDataRange().getValues();
    if (!data.length) return false;
    const h = data[0];
    const tokenCol = h.indexOf('access_token');
    const issueCol = h.indexOf('issue_id');
    const statusCol = h.indexOf('status');
    const expiryCol = h.indexOf('access_expires_at');
    const deviceCol = h.indexOf('access_device_id');
    if ([tokenCol, issueCol, statusCol, expiryCol, deviceCol].some(x => x < 0)) {
      throw new Error('Требуется обновить служебную таблицу для защиты персональных ссылок.');
    }
    const now = new Date();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[tokenCol]) !== String(token) || String(row[issueCol]) !== String(issueId) || !['paid', 'link_sent', 'activated'].includes(row[statusCol]) || !row[expiryCol] || new Date(row[expiryCol]) <= now) continue;
      const bound = String(row[deviceCol] || '').trim();
      if (bound && bound !== id) return false;
      if (!bound) {
        sh.getRange(i + 1, deviceCol + 1).setValue(id);
        if (row[statusCol] === 'link_sent' || row[statusCol] === 'paid') sh.getRange(i + 1, statusCol + 1).setValue('activated');
      }
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function parseJson_(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch (e) {
    return fallback;
  }
}

function truth_(value) {
  return value === true ||
    value === 1 ||
    String(value).toLowerCase() === 'true' ||
    String(value) === '1' ||
    String(value).toLowerCase() === 'yes';
}

function formatDate_(value) {
  return value instanceof Date
    ? Utilities.formatDate(value, CFG.TIMEZONE, 'yyyy-MM-dd')
    : String(value || '').slice(0, 10);
}


// Публичное сообщение редакции на главной странице. Хранится в Script Properties.
function adminNoticeData_() {
  const props = PropertiesService.getScriptProperties();
  return {
    text: String(props.getProperty('PUBLIC_EDITOR_NOTICE') || ''),
    active: props.getProperty('PUBLIC_EDITOR_NOTICE_ACTIVE') === '1',
    updated_at: String(props.getProperty('PUBLIC_EDITOR_NOTICE_UPDATED') || '')
  };
}

function publicNotice_() {
  const n = adminNoticeData_();
  return n.active && n.text ? { text: n.text, updated_at: n.updated_at } : { text: '', updated_at: '' };
}

function adminSaveNotice_(p) {
  const text = String(p.text || '').trim();
  const active = p.active === true;
  if (text.length > 3000) throw new Error('Сообщение слишком длинное. Максимум 3000 символов.');
  if (active && !text) throw new Error('Введите текст сообщения перед публикацией.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PUBLIC_EDITOR_NOTICE', text);
  props.setProperty('PUBLIC_EDITOR_NOTICE_ACTIVE', active ? '1' : '0');
  props.setProperty('PUBLIC_EDITOR_NOTICE_UPDATED', Utilities.formatDate(new Date(), CFG.TIMEZONE, 'dd.MM.yyyy HH:mm'));
  return adminNoticeData_();
}
