const { ref, get, set } = require('firebase/database');

// نمایش پنل مدیریت دکمه‌های پویا (فقط برای ادمین)
async function showDynamicButtonsPanel(bot, db, userId) {
  const snapshot = await get(ref(db, 'dynamic_buttons'));
  let buttons = snapshot.exists() ? snapshot.val() : [];
  if (!Array.isArray(buttons)) buttons = [];

  const inline_keyboard = [];
  inline_keyboard.push([{ text: '➕ ردیف جدید', callback_data: `dynbtn_add_row_0` }]);

  buttons.forEach((row, rowIdx) => {
    const rowBtns = [{ text: '➕', callback_data: `dynbtn_add_btn_${rowIdx}_0` }];
    row.forEach((btn, colIdx) => {
      rowBtns.push({ text: btn.text, callback_data: `dynbtn_edit_btn_${rowIdx}_${colIdx}` });
      rowBtns.push({ text: '➕', callback_data: `dynbtn_add_btn_${rowIdx}_${colIdx + 1}` });
    });
    inline_keyboard.push(rowBtns);

    const editRow = [];
    row.forEach((btn, colIdx) => {
      editRow.push({ text: '📝', callback_data: `dynbtn_edit_btn_text_${rowIdx}_${colIdx}` });
      editRow.push({ text: '✖️', callback_data: `dynbtn_del_btn_${rowIdx}_${colIdx}` });
      editRow.push({ text: ' ', callback_data: 'noop' });
    });
    if (editRow.length > 0) inline_keyboard.push(editRow);
    inline_keyboard.push([{ text: '➕ ردیف جدید', callback_data: `dynbtn_add_row_${rowIdx + 1}` }]);
  });
  inline_keyboard.push([{ text: 'بازگشت 🔙', callback_data: 'panel_back' }]);

  await bot.sendMessage(userId, 'مدیریت دکمه‌های پویا:', {
    reply_markup: { inline_keyboard }
  });
}

// نمونه ساده هندل callback (در index.js باید کامل‌تر بنویسی)
async function handleDynamicButtonsCallback(bot, db, query, userState) {
  const userId = query.from.id, data = query.data;
  let m;
  if (m = data.match(/^dynbtn_add_row_(\d+)$/)) {
    const idx = parseInt(m[1]);
    const snapshot = await get(ref(db, 'dynamic_buttons'));
    let buttons = snapshot.exists() ? snapshot.val() : [];
    if (!Array.isArray(buttons)) buttons = [];
    buttons.splice(idx, 0, []);
    await set(ref(db, 'dynamic_buttons'), buttons);
    return showDynamicButtonsPanel(bot, db, userId);
  }
  // بقیه هندل‌ها مشابه توضیح بالا پیاده‌سازی شود
}

async function handleDynamicButtonsMessage(bot, db, msg, userState) {
  // مشابه توضیحات قبلی، برای گرفتن متن و نوع پاسخ و درج دکمه
}

module.exports = { showDynamicButtonsPanel, handleDynamicButtonsCallback, handleDynamicButtonsMessage };