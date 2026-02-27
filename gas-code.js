/**
 * バク売れLPテンプレ — Google Apps Script (GAS)
 * ─────────────────────────────────────────────
 * Spreadsheet ID: 1jDA44f0mSrQDDeZhvFi1qLyCum_FkABq4s_6MIYjFVc
 *
 * Sheets (gid):
 *   契約データ      : gid=358495717
 *   パートナー振込先 : gid=1361799622
 *   成約報告        : gid=107328201
 *
 * ★ このファイルの内容を Google Apps Script エディタに貼り付けてデプロイしてください。
 */

const SS_ID = '1jDA44f0mSrQDDeZhvFi1qLyCum_FkABq4s_6MIYjFVc';
const GID_CONTRACT = 358495717;
const GID_BANK     = 1361799622;
const GID_SALES    = 107328201;

/* ─── Utility ─── */
function getSheetByGid(gid) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return null;
}

function timestamp() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}

function dateOnly() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
}

function nextMonthEnd() {
  var now = new Date();
  var d = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─── CORS headers for GET ─── */
function doGet(e) {
  var action = (e.parameter.action || '').trim();

  if (action === 'checkBankInfo') {
    return handleCheckBankInfo(e.parameter);
  }

  return jsonResponse({ status: 'ok', message: 'GET received' });
}

/* ─── POST router ─── */
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ status: 'error', message: 'Invalid JSON' });
  }

  var action = (data.action || '').trim();

  switch (action) {
    case 'contract':
      return handleContract(data);
    case 'updatePaymentStatus':
      return handleUpdatePaymentStatus(data);
    case 'contact':
      return handleContact(data);
    case 'registerBankInfo':
      return handleRegisterBankInfo(data);
    case 'submitConversionReport':
      return handleSubmitConversionReport(data);
    default:
      return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  }
}

/* ═══════════════════════════════════════════
   1. 契約フォーム送信
   ═══════════════════════════════════════════ */
function handleContract(data) {
  var sheet = getSheetByGid(GID_CONTRACT);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Contract sheet not found' });

  // Columns: タイムスタンプ, 氏名, メールアドレス, 会社名, ご紹介者名, 契約プラン, 金額, お支払方法, 支払いステータス, Stripe支払い完了日時, 支払い完了日
  sheet.appendRow([
    timestamp(),
    data.name || '',
    data.email || '',
    data.company || '',
    data.referrer || '',
    data.product || '',
    data.price || '',
    data.paymentMethod || '',
    '未払い',
    '',
    ''
  ]);

  return jsonResponse({ status: 'ok', message: 'Contract saved' });
}

/* ═══════════════════════════════════════════
   2. Stripe 支払い完了ステータス更新
   ═══════════════════════════════════════════ */
function handleUpdatePaymentStatus(data) {
  var sheet = getSheetByGid(GID_CONTRACT);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Contract sheet not found' });

  var name  = (data.name || '').trim();
  var email = (data.email || '').trim();
  if (!name && !email) return jsonResponse({ status: 'error', message: 'No identifier' });

  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    var rowName  = (rows[i][1] || '').toString().trim();
    var rowEmail = (rows[i][2] || '').toString().trim();
    if ((name && rowName === name) || (email && rowEmail === email)) {
      sheet.getRange(i + 1, 9).setValue('支払い済み');        // 支払いステータス
      sheet.getRange(i + 1, 10).setValue(timestamp());        // Stripe支払い完了日時
      sheet.getRange(i + 1, 11).setValue(dateOnly());         // 支払い完了日
      return jsonResponse({ status: 'ok', message: 'Payment status updated' });
    }
  }

  return jsonResponse({ status: 'ok', message: 'Row not found, but no error' });
}

/* ═══════════════════════════════════════════
   3. お問い合わせ (contact)
   ═══════════════════════════════════════════ */
function handleContact(data) {
  // お問い合わせはメール送信など必要に応じてカスタマイズ
  var subject = 'お問い合わせ: ' + (data.subject || '(件名なし)');
  var body = 'お名前: ' + (data.name || '') + '\n'
           + 'メール: ' + (data.email || '') + '\n'
           + '内容:\n' + (data.message || '');
  try {
    MailApp.sendEmail('info@chainsoda.world', subject, body);
  } catch (err) {
    Logger.log('Mail send error: ' + err);
  }
  return jsonResponse({ status: 'ok', message: 'Contact received' });
}

/* ═══════════════════════════════════════════
   4. パートナー振込先情報の登録・更新
   ═══════════════════════════════════════════ */
function handleRegisterBankInfo(data) {
  var sheet = getSheetByGid(GID_BANK);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Bank sheet not found' });

  var partnerName = (data.partnerName || '').trim();
  if (!partnerName) return jsonResponse({ status: 'error', message: 'partnerName required' });

  // Check if already exists → update
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if ((rows[i][0] || '').toString().trim() === partnerName) {
      // Update existing row
      // Columns: 正規代理店氏名, 会社名, 銀行名, 銀行コード, 支店名, 支店コード, 口座種別, 口座番号, 口座名義カナ, 登録日
      var range = sheet.getRange(i + 1, 1, 1, 10);
      range.setValues([[
        partnerName,
        data.company || '',
        data.bankName || '',
        data.bankCode || '',
        data.branchName || '',
        data.branchCode || '',
        data.accountType || '普通',
        data.accountNumber || '',
        data.accountHolder || '',
        timestamp()
      ]]);
      return jsonResponse({ status: 'ok', message: 'Bank info updated' });
    }
  }

  // New registration
  sheet.appendRow([
    partnerName,
    data.company || '',
    data.bankName || '',
    data.bankCode || '',
    data.branchName || '',
    data.branchCode || '',
    data.accountType || '普通',
    data.accountNumber || '',
    data.accountHolder || '',
    timestamp()
  ]);

  return jsonResponse({ status: 'ok', message: 'Bank info registered' });
}

/* ═══════════════════════════════════════════
   5. 口座登録済みチェック (GET)
   ═══════════════════════════════════════════ */
function handleCheckBankInfo(params) {
  var partnerName = (params.partnerName || '').trim();
  if (!partnerName) return jsonResponse({ registered: false });

  var sheet = getSheetByGid(GID_BANK);
  if (!sheet) return jsonResponse({ registered: false });

  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if ((rows[i][0] || '').toString().trim() === partnerName) {
      return jsonResponse({
        registered: true,
        bankName:      (rows[i][2] || '').toString(),
        bankCode:      (rows[i][3] || '').toString(),
        branchName:    (rows[i][4] || '').toString(),
        branchCode:    (rows[i][5] || '').toString(),
        accountType:   (rows[i][6] || '').toString(),
        accountNumber: (rows[i][7] || '').toString(),
        accountHolder: (rows[i][8] || '').toString(),
        company:       (rows[i][1] || '').toString()
      });
    }
  }

  return jsonResponse({ registered: false });
}

/* ═══════════════════════════════════════════
   6. 成約報告の送信
   ═══════════════════════════════════════════ */
function handleSubmitConversionReport(data) {
  var sheet = getSheetByGid(GID_SALES);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sales sheet not found' });

  // Columns: 申請日時, 正規代理店名, お客様氏名, 成約商品, 販売額（税込）, 報酬額（税込）, 報酬振込先ステータス, 振込予定日, 振込ステータス, 顧客支払確認
  sheet.appendRow([
    timestamp(),
    data.partnerName || '',
    data.customerName || '',
    data.product || '',
    data.salesAmount || '',
    data.rewardAmount || '',
    data.bankStatus || '',
    data.transferDate || nextMonthEnd(),
    '未振込',
    '未確認'
  ]);

  return jsonResponse({ status: 'ok', message: 'Conversion report submitted' });
}
