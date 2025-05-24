// نسخه پیشرفته برای نمایش مدیریت دکمه‌های پویا
async function showDynamicButtonsPanel(bot, db, userId) {
  const { get } = require('firebase/database'); // اگر بالا import نکردی، اینجا اضافه کن
  const snapshot = await get(ref(db, 'dynamic_buttons'));
  let buttons = snapshot.exists() ? snapshot.val() : [];
  if (!Array.isArray(buttons)) buttons = [];

  // هر ردیف را با ویرایش/حذف/جابجایی نشان بده
  let inline_keyboard = [];
  buttons.forEach((row, rowIdx) => {
    let rowBtns = row.map((btn, btnIdx) => [
      { text: btn.text, callback_data: `dynbtn_edit_${rowIdx}_${btnIdx}` },
      { text: '✏️', callback_data: `dynbtn_edit_${rowIdx}_${btnIdx}` },
      { text: '🗑', callback_data: `dynbtn_delete_${rowIdx}_${btnIdx}` },
      { text: '⬆️', callback_data: `dynbtn_move_${rowIdx}_${btnIdx}_up` },
      { text: '⬇️', callback_data: `dynbtn_move_${rowIdx}_${btnIdx}_down` },
      { text: '⬅️', callback_data: `dynbtn_move_${rowIdx}_${btnIdx}_left` },
      { text: '➡️', callback_data: `dynbtn_move_${rowIdx}_${btnIdx}_right` }
    ]);
    rowBtns.forEach(btn => inline_keyboard.push(btn));
  });

  // دکمه‌های افزودن و بازگشت
  inline_keyboard.push([
    { text: '➕ ردیف جدید', callback_data: 'dynbtn_add_row' },
    { text: '➕ دکمه جدید', callback_data: 'dynbtn_add' },
    { text: '↩️ بازگشت', callback_data: 'panel_back' }
  ]);

  await bot.sendMessage(userId, 'مدیریت دکمه‌های پویا:', {
    reply_markup: { inline_keyboard }
  });
}
module.exports = { showDynamicButtonsPanel };