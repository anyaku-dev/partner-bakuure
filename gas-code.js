/**
 * バク売れLPテンプレ — Google Apps Script (GAS)
 * ─────────────────────────────────────────────
 * Spreadsheet ID: 1jDA44f0mSrQDDeZhvFi1qLyCum_FkABq4s_6MIYjFVc
 *
 * Sheets (gid):
 *   契約データ           : gid=358495717
 *   パートナー口座情報    : gid=1361799622
 *   パートナー販売成果管理 : gid=107328201
 *
 * ★ このファイルの内容を Google Apps Script エディタに貼り付けてデプロイしてください。
 */

const SHEET_ID   = '1jDA44f0mSrQDDeZhvFi1qLyCum_FkABq4s_6MIYjFVc';
const GID_TENPRE = 358495717;
const GID_BANK   = 1361799622;
const GID_SALES  = 107328201;

function getSheetByGid(gid) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = ss.getSheets();
  for (const s of sheets) {
    if (s.getSheetId() === gid) return s;
  }
  return null;
}

/** 日本標準時の現在時刻文字列 */
function jstNow() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}

/** 翌月末日 */
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

/* ═══════════════════════════════════════════
   GET handler
   ═══════════════════════════════════════════ */
function doGet(e) {
  var action = (e.parameter.action || '').trim();

  if (action === 'checkBankInfo') {
    return handleCheckBankInfo(e.parameter);
  }

  return jsonResponse({ status: 'ok', message: 'GET received' });
}

/* ═══════════════════════════════════════════
   POST handler
   ═══════════════════════════════════════════ */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || '';

    if (action === 'contract')               return handleContract(data);
    if (action === 'updatePaymentStatus')    return handlePaymentStatus(data);
    if (action === 'contact')                return handleContact(data);
    if (action === 'registerBankInfo')       return handleRegisterBankInfo(data);
    if (action === 'submitConversionReport') return handleSubmitConversionReport(data);

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════════════════════════════════
   1. 契約データの記録（upsert）
   gid=358495717
   カラム構成:
     A(1)  タイムスタンプ
     B(2)  会社名
     C(3)  顧客氏名
     D(4)  メールアドレス
     E(5)  ご紹介者氏名
     F(6)  契約ステータス
     G(7)  商品名
     H(8)  金額
     I(9)  支払方法
     J(10) 支払ステータス
     K(11) 支払い完了日
   ═══════════════════════════════════════════ */
function handleContract(data) {
  const sheet = getSheetByGid(GID_TENPRE);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet not found' });

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'タイムスタンプ', '会社名', '顧客氏名', 'メールアドレス',
      'ご紹介者氏名', '契約ステータス', '商品名', '金額',
      '支払方法', '支払ステータス', '支払い完了日'
    ]);
  }

  const name          = data.name || '';
  const email         = data.email || '';
  const company       = data.company || '';
  const referrer      = data.referrer || '';
  const product       = data.product || '';
  const price         = data.price || '';
  const paymentMethod = data.paymentMethod || 'クレジットカード';
  const timestamp     = jstNow();

  const lastRow = sheet.getLastRow();
  let existingRow = -1;
  if (lastRow > 1) {
    const names  = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    const emails = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    for (let i = 0; i < names.length; i++) {
      if (names[i][0] === name && emails[i][0] === email) {
        existingRow = i + 2;
        break;
      }
    }
  }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1).setValue(timestamp);
    sheet.getRange(existingRow, 2).setValue(company);
    sheet.getRange(existingRow, 5).setValue(referrer);
    sheet.getRange(existingRow, 6).setValue('契約済み');
    sheet.getRange(existingRow, 7).setValue(product);
    sheet.getRange(existingRow, 8).setValue(price);
    sheet.getRange(existingRow, 9).setValue(paymentMethod);
    const currentPayStatus = sheet.getRange(existingRow, 10).getValue();
    if (!currentPayStatus || currentPayStatus === '') {
      sheet.getRange(existingRow, 10).setValue('未決済');
    }
  } else {
    sheet.appendRow([
      timestamp, company, name, email,
      referrer, '契約済み', product, price,
      paymentMethod, '未決済', ''
    ]);
  }

  return jsonResponse({ status: 'ok' });
}

/* ═══════════════════════════════════════════
   2. 決済ステータス更新（Stripeサンクスページ）
   ═══════════════════════════════════════════ */
function handlePaymentStatus(data) {
  const sheet = getSheetByGid(GID_TENPRE);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sheet not found' });

  const name  = data.name || '';
  const email = data.email || '';
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return jsonResponse({ status: 'error', message: 'No data' });

  const names  = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  const emails = sheet.getRange(2, 4, lastRow - 1, 1).getValues();

  for (let i = 0; i < names.length; i++) {
    if (names[i][0] === name && emails[i][0] === email) {
      const row = i + 2;
      sheet.getRange(row, 10).setValue('決済完了');
      sheet.getRange(row, 11).setValue(jstNow());
      return jsonResponse({ status: 'ok' });
    }
  }

  return jsonResponse({ status: 'error', message: 'Record not found' });
}

/* ═══════════════════════════════════════════
   3. お問い合わせ（メール通知）
   ═══════════════════════════════════════════ */
function handleContact(data) {
  const subject = '【バク売れLPテンプレ】お問い合わせ: ' + (data.category || '');
  const body = '氏名: ' + (data.name || '') + '\n'
    + 'メール: ' + (data.email || '') + '\n'
    + '種別: ' + (data.category || '') + '\n'
    + '内容:\n' + (data.message || '');

  MailApp.sendEmail('info@chainsoda.world', subject, body);
  return jsonResponse({ status: 'ok' });
}

/* ═══════════════════════════════════════════
   4. パートナー口座情報の登録・更新（upsert）
   gid=1361799622
   カラム構成:
     A(1)  正規代理店氏名
     B(2)  会社名（任意）
     C(3)  銀行名
     D(4)  銀行コード
     E(5)  支店名
     F(6)  支店コード
     G(7)  口座種別
     H(8)  口座番号
     I(9)  口座名義（カナ）
     J(10) 登録日
   ═══════════════════════════════════════════ */
function handleRegisterBankInfo(data) {
  const sheet = getSheetByGid(GID_BANK);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Bank sheet not found' });

  const partnerName = (data.partnerName || '').trim();
  if (!partnerName) return jsonResponse({ status: 'error', message: 'partnerName required' });

  const rowData = [
    partnerName,              // A: 正規代理店氏名
    data.company || '',       // B: 会社名（任意）
    data.bankName || '',      // C: 銀行名
    data.bankCode || '',      // D: 銀行コード
    data.branchName || '',    // E: 支店名
    data.branchCode || '',    // F: 支店コード
    data.accountType || '普通', // G: 口座種別
    data.accountNumber || '', // H: 口座番号
    data.accountHolder || '', // I: 口座名義（カナ）
    jstNow()                  // J: 登録日
  ];

  // upsert: 正規代理店氏名(A列)一致で既存行を探す
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < names.length; i++) {
      if ((names[i][0] || '').toString().trim() === partnerName) {
        sheet.getRange(i + 2, 1, 1, 10).setValues([rowData]);
        return jsonResponse({ status: 'ok', message: 'Bank info updated' });
      }
    }
  }

  sheet.appendRow(rowData);
  return jsonResponse({ status: 'ok', message: 'Bank info registered' });
}

/* ═══════════════════════════════════════════
   5. 口座登録済みチェック（GET）
   gid=1361799622
   ═══════════════════════════════════════════ */
function handleCheckBankInfo(params) {
  const partnerName = (params.partnerName || '').trim();
  if (!partnerName) return jsonResponse({ registered: false });

  const sheet = getSheetByGid(GID_BANK);
  if (!sheet) return jsonResponse({ registered: false });

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return jsonResponse({ registered: false });

  const rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
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
   gid=107328201
   カラム構成:
     A(1)  申請日時
     B(2)  正規代理店名
     C(3)  お客様氏名
     D(4)  成約商品
     E(5)  販売額（税込）
     F(6)  報酬額（税込）
     G(7)  報酬振込先ステータス
     H(8)  振込予定日
     I(9)  振込ステータス
     J(10) 顧客支払確認
   ═══════════════════════════════════════════ */
function handleSubmitConversionReport(data) {
  const sheet = getSheetByGid(GID_SALES);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Sales sheet not found' });

  sheet.appendRow([
    jstNow(),                              // A: 申請日時
    data.partnerName || '',                // B: 正規代理店名
    data.customerName || '',               // C: お客様氏名
    data.product || '',                    // D: 成約商品
    data.salesAmount || '',                // E: 販売額（税込）
    data.rewardAmount || '',               // F: 報酬額（税込）
    data.bankStatus || '',                 // G: 報酬振込先ステータス
    data.transferDate || nextMonthEnd(),   // H: 振込予定日
    '未振込',                               // I: 振込ステータス
    '未確認'                                // J: 顧客支払確認
  ]);

  return jsonResponse({ status: 'ok', message: 'Conversion report submitted' });
}
