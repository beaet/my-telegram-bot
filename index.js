require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, update, remove, push } = require('firebase/database');

const app = express();

const token = process.env.BOT_TOKEN;
const adminId = Number(process.env.ADMIN_ID);
const webhookUrl = process.env.WEBHOOK_URL;
const port = process.env.PORT || 10000;
let botActive = true

// ---- Firebase Config ----
const firebaseConfig = {
  databaseURL: process.env.DATABASE_URL,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ---- User Helper Functions ----
const userRef = userId => ref(db, `users/${userId}`);
async function ensureUser(user) {
  const snap = await get(userRef(user.id));
  if (!snap.exists()) {
    await set(userRef(user.id), {
      user_id: user.id,
      banned: 0,
      last_chance_use: 0,
      username: user.username || '',
      invites: 0,
      points: 5,
      invited_by: null
    });
  }
}
async function getUser(userId) {
  const snap = await get(userRef(userId));
  return snap.exists() ? snap.val() : null;
}
async function updatePoints(userId, amount) {
  const user = await getUser(userId);
  if (user) await update(userRef(userId), { points: (user.points || 0) + amount });
}
async function updateLastChanceUse(userId, timestamp) {
  await update(userRef(userId), { last_chance_use: timestamp });
}
async function setBanStatus(userId, status) {
  await update(userRef(userId), { banned: status ? 1 : 0 });
}
const settingsRef = key => ref(db, `settings/${key}`);
async function getHelpText() {
  const snap = await get(settingsRef('help_text'));
  return snap.exists() ? snap.val() : 'متن راهنما موجود نیست.';
}
async function setHelpText(newText) {
  await set(settingsRef('help_text'), newText);
}

async function getAllUsersFromDatabase() {
  // مثلا نمونه برای SQLite:
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, points FROM users', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ---- Gift Code helpers ----
const giftCodeRef = code => ref(db, `gift_codes/${code}`);
const globalGiftCodeRef = code => ref(db, `global_gift_codes/${code}`);
async function upsertGiftCode(code, points) {
  await set(giftCodeRef(code), points);
}
async function deleteGiftCode(code) {
  await remove(giftCodeRef(code));
}
async function getGiftCode(code) {
  const snap = await get(giftCodeRef(code));
  return snap.exists() ? snap.val() : null;
}
async function upsertGlobalGiftCode(code, points) {
  await set(globalGiftCodeRef(code), { points, users_used: {} });
}
async function getGlobalGiftCode(code) {
  const snap = await get(globalGiftCodeRef(code));
  return snap.exists() ? snap.val() : null;
}
async function addUserToGlobalGiftCode(code, userId) {
  const gift = await getGlobalGiftCode(code);
  if (!gift) return false;
  let users_used = gift.users_used || {};
  users_used[userId] = true;
  await update(globalGiftCodeRef(code), { users_used });
  return true;
}
async function deleteGlobalGiftCode(code) {
  await remove(globalGiftCodeRef(code));
}
async function listGiftCodesCombined() {
  const codesSnap = await get(ref(db, 'gift_codes'));
  const codes = codesSnap.exists() ? Object.keys(codesSnap.val()).map(code => ({
    type: 'یکبارمصرف',
    code,
    points: codesSnap.val()[code]
  })) : [];
  const globalSnap = await get(ref(db, 'global_gift_codes'));
  const gCodes = globalSnap.exists()
    ? Object.keys(globalSnap.val()).map(code => ({
        type: 'همگانی',
        code,
        points: globalSnap.val()[code].points
      }))
    : [];
  return codes.concat(gCodes);
}

// ---- Squad Request Helpers ----
const squadReqRef = id => ref(db, `squad_requests/${id}`);
const squadReqsRef = ref(db, 'squad_requests');
async function getSquadReq(id) {
  const snap = await get(squadReqRef(id));
  return snap.exists() ? snap.val() : null;
}
async function getAllSquadReqs(filter = {}) {
  const snap = await get(squadReqsRef);
  if (!snap.exists()) return [];
  let reqs = Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
  // فیلتر بر اساس وضعیت تایید و حذف نشده بودن
  if (filter.approved !== undefined)
    reqs = reqs.filter(r => !!r.approved === !!filter.approved);
  if (filter.user_id !== undefined)
    reqs = reqs.filter(r => r.user_id === filter.user_id);
  if (filter.deleted !== undefined)
    reqs = reqs.filter(r => !!r.deleted === !!filter.deleted);
  return reqs.filter(r => !r.deleted);
}

// ---- Anti-Spam ----
const buttonSpamMap = {}; // { userId: [timestamps] }
const muteMap = {}; // { userId: muteUntilTimestamp }
function isMuted(userId) {
  if (!muteMap[userId]) return false;
  if (Date.now() > muteMap[userId]) {
    delete muteMap[userId];
    return false;
  }
  return true;
}

// ---- User State ----
const userState = {};
const supportChatMap = {};

// ---- Bot Init ----
(async () => {
  await fetchBotActiveStatus();
  // اینجا بقیه کدهای bot و express را بنویس
  // مثلاً:
  const bot = new TelegramBot(token, { polling: false });
  bot.setWebHook(`${webhookUrl}/bot${token}`);

  app.use(express.json());
  app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
// ---- Main Menu ----
function mainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
    [
      { text: '📊محاسبه ریت', callback_data: 'calculate_rate' },
      { text: '🏆محاسبه برد و باخت', callback_data: 'calculate_wl' }
    ],
    [
      { text: '⚔ هیرو کانتر', callback_data: 'hero_counter' },
      { text: '🧩 تورنومنت', callback_data: 'tournament' }
    ],
    [
      { text: '📜 لیست پیک/بن', callback_data: 'pickban_list' }
    ],
    [
      { text: '🔥 چالش', callback_data: 'challenge' }
    ],
    [
      { text: '🔗دعوت دوستان', callback_data: 'referral' },
      { text: '👤 پروفایل', callback_data: 'profile' }
    ],
    [
      { text: '➕ ثبت درخواست اسکواد', callback_data: 'squad_request' },
      { text: '👥 مشاهده اسکوادها', callback_data: 'view_squads' }
    ],
    [
      { text: '💬پشتیبانی', callback_data: 'support' }
    ],
    [
      { text: '📚راهنما', callback_data: 'help' }
    ],
    [
      { text: '💰خرید امتیاز', callback_data: 'buy' }
    ],
    [
      { text: '🍀 شانس', callback_data: 'chance' },
      { text: '🎁 کد هدیه', callback_data: 'gift_code' }
    ]
      ]
    }
  };
}
function sendMainMenu(userId, messageId = null, currentText = null, currentMarkup = null) {
  const text = 'سلام، به ربات محاسبه‌گر Mobile Legends خوش آمدید ✨';
  const { reply_markup } = mainMenuKeyboard();

  if (messageId) {
    // فقط اگر متن یا مارکاپ تغییر کرده باشد ویرایش کن
    if (text !== currentText || JSON.stringify(reply_markup) !== JSON.stringify(currentMarkup)) {
      bot.editMessageText(text, {
        chat_id: userId,
        message_id: messageId,
        reply_markup
      });
    }
  } else {
    bot.sendMessage(userId, text, { reply_markup });
  }
}

// ---- /start with referral ----
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;
  
  if (!botActive && msg.from.id !== adminId) {
    return bot.sendMessage(msg.from.id, "ربات موقتاً خاموش است.");
  }

  await ensureUser(msg.from);
  const user = await getUser(userId);
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده از ربات را ندارید.');
  }
  if (refId && refId !== userId) {
    const refUser = await getUser(refId);
    if (refUser && !user.invited_by) {
      await update(userRef(userId), { invited_by: refId });
      await updatePoints(refId, 5);
      await update(userRef(refId), { invites: (refUser.invites || 0) + 1 });
      bot.sendMessage(refId, `🎉 یک نفر با لینک دعوت شما وارد ربات شد و ۵ امتیاز گرفتید!`);
    }
  }
  userState[userId] = null;
  sendMainMenu(userId);
});

// ---- Bot Active State with Firebase ----
async function setBotActiveStatus(isActive) {
  await set(ref(db, 'settings/bot_active'), isActive ? 1 : 0);
  botActive = !!isActive;
}

async function fetchBotActiveStatus() {
  const snap = await get(ref(db, 'settings/bot_active'));
  if (snap.exists()) {
    botActive = !!snap.val();
  } else {
    botActive = true; // اگر موجود نبود، به طور پیش‌فرض فعال است
  }
}

// ---- Panel for admin ----
bot.onText(/\/panel/, async (msg) => {
  const userId = msg.from.id;
  if (userId !== adminId) {
    return bot.sendMessage(userId, 'شما دسترسی به پنل مدیریت ندارید.');
  }
  bot.sendMessage(userId, 'پنل مدیریت:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ افزودن امتیاز', callback_data: 'add_points' },
          { text: '➖ کسر امتیاز', callback_data: 'sub_points' }
        ],
        [
          { text: '📢 پیام همگانی', callback_data: 'broadcast' }
        ],
        [
          { text: '🚫بن کردن کاربر', callback_data: 'ban_user' },
          { text: '☑️حذف بن کاربر', callback_data: 'unban_user' }
        ],
        [
          { text: '🌐تغییر متن راهنما', callback_data: 'edit_help' }
        ],
        [
          { text: '🎯 دادن امتیاز به همه', callback_data: 'add_points_all' },
          { text: '↩️ بازگشت', callback_data: 'panel_back' }
        ],
        [
          { text: '➕ افزودن کد هدیه', callback_data: 'add_gift_code' },
          { text: '➖ حذف کد هدیه', callback_data: 'delete_gift_code' }
        ],
        [
          { text: '🎁 ساخت کد هدیه همگانی', callback_data: 'add_global_gift_code' }
        ],
        [
          { text: '📜 لیست همه کدها', callback_data: 'list_gift_codes' },
          { text: '📊 آمار ربات', callback_data: 'bot_stats' }
        ],
        [
          { text: '🔍 مدیریت اسکوادها', callback_data: 'admin_squad_list' }
        ],
        [
          { text: '🟢 روشن کردن ربات', callback_data: 'activate_bot' },
          { text: '🔴 خاموش کردن ربات', callback_data: 'deactivate_bot' }
        ],
        [
          { text: '🗑 حذف اسکواد تاییدشده', callback_data: 'admin_delete_approved_squads' }
        ],
        [
          { text: '📋 جزییات کاربران', callback_data: 'user_details' }
        ]
      ]
    }
  });
});

// ---- CALLBACK QUERIES ----
bot.on('callback_query', async (query) => {
  if (!botActive && query.from.id !== adminId) {
    await bot.answerCallbackQuery(query.id, { text: 'ربات موقتاً خاموش است.', show_alert: true });
    return;
  }

  const userId = query.from.id;
  const data = query.data;
  const messageId = query.message && query.message.message_id;
  const currentText = query.message.text;
  const currentMarkup = query.message.reply_markup || null;

  // فرض بر این که می‌خواهی منوی اصلی را نمایش بدهی
  
if (data === 'deactivate_bot' && userId === adminId) {
  await setBotActiveStatus(false);
  await bot.answerCallbackQuery(query.id, { text: 'ربات برای کاربران عادی خاموش شد.' });
  return;
}
if (data === 'activate_bot' && userId === adminId) {
  await setBotActiveStatus(true);
  await bot.answerCallbackQuery(query.id, { text: 'ربات برای کاربران عادی روشن شد.' });
  return;
}

  // ---- Anti-Spam ----
  if (userId !== adminId) {
    if (isMuted(userId)) {
      await bot.answerCallbackQuery(query.id, { text: '🚫 به دلیل اسپم کردن دکمه‌ها، تا پانزده دقیقه نمی‌توانید از ربات استفاده کنید.', show_alert: true });
      return;
    }
    if (!buttonSpamMap[userId]) buttonSpamMap[userId] = [];
    const now = Date.now();
    buttonSpamMap[userId] = buttonSpamMap[userId].filter(ts => now - ts < 8000);
    buttonSpamMap[userId].push(now);
    if (buttonSpamMap[userId].length > 8) {
      muteMap[userId] = now + 15 * 60 * 1000; // 15 دقیقه میوت
      buttonSpamMap[userId] = [];
      await bot.answerCallbackQuery(query.id, { text: '🚫 به دلیل اسپم کردن دکمه‌ها، تا پانزده دقیقه نمی‌توانید از ربات استفاده کنید.', show_alert: true });
      return;
    }
  }
  
  if (data === 'tournament') {
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(userId, 'فعلاً هیچ تورنمنتی در دسترس نیست.\nجزییات بیشتری بزودی اعلام خواهد شد.');
  return;
}
if (data === 'hero_counter') {
  await bot.answerCallbackQuery(query.id, { text: 'این بخش به زودی فعال می‌شود. لطفا منتظر بمانید.', show_alert: true });
  return;
}
if (data === 'challenge') {
  await bot.answerCallbackQuery(query.id, { text: 'این بخش فعلاً از دسترس خارج شده است.', show_alert: true });
  return;
}

  // ---- Main menu back ----
  if (data === 'main_menu') {
    await bot.answerCallbackQuery(query.id);
    sendMainMenu(userId, messageId);
    return;
  }

  const user = await getUser(userId);
  if (!user) return await bot.answerCallbackQuery(query.id, { text: 'خطا در دریافت اطلاعات کاربر.', show_alert: true });
  if (user?.banned) return await bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید و اجازه استفاده ندارید.', show_alert: true });

  // ---- لیست پیک/بن ----
  if (data === 'pickban_list') {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId,
      'جهت مشاهده لیست بیشترین پیک ریت و بن در این سیزن روی دکمه زیر کلیک کنید:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'مشاهده در سایت رسمی', url: 'https://www.mobilelegends.com/rank' }],
            [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }

  // ---- بخش شانس ----
  if (data === 'chance') {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId, '🍀 شانست رو انتخاب کن!\n\n🎲 اگر تاس بندازی و ۶ بیاد: ۲ امتیاز می‌گیری\n⚽ اگر پنالتی بزنی و گل بشه (GOAL): ۱ امتیاز می‌گیری\n🎯 اگر دارت بزنی و وسط هدف (BULLSEYE) بزنی: ۱ امتیاز می‌گیری\n\nیک گزینه رو انتخاب کن', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎲 تاس', callback_data: 'chance_dice' },
            { text: '⚽ فوتبال', callback_data: 'chance_football' },
            { text: '🎯 دارت', callback_data: 'chance_dart' }
          ],
          [
            { text: 'بازگشت 🔙', callback_data: 'main_menu' }
          ]
        ]
      }
    });
  }
  if (data === 'chance_dice' || data === 'chance_football' || data === 'chance_dart') {
    const now = Date.now();
    const lastUse = user.last_chance_use || 0;
    if (userId !== adminId && now - lastUse < 24 * 60 * 60 * 1000) {
      await bot.answerCallbackQuery(query.id, { text: 'تا ۲۴ ساعت آینده نمی‌تونی دوباره امتحان کنی.', show_alert: true });
      return;
    }
    let emoji, winValue, prize, readable;
    if (data === 'chance_dice') {
      emoji = '🎲'; winValue = 6; prize = 2; readable = 'عدد ۶';
    } else if (data === 'chance_football') {
      emoji = '⚽'; winValue = 3; prize = 1; readable = 'GOAL';
    } else if (data === 'chance_dart') {
      emoji = '🎯'; winValue = 6; prize = 1; readable = 'BULLSEYE';
    }
    const diceMsg = await bot.sendDice(userId, { emoji });
    let isWin = diceMsg.dice.value === winValue;
    if (userId !== adminId) await updateLastChanceUse(userId, now);
    if (isWin) {
      await updatePoints(userId, prize);
      await bot.sendMessage(userId, `تبریک! شانست گرفت و (${readable}) اومد و ${prize} امتیاز گرفتی!`);
    } else {
      await bot.sendMessage(userId, `متاسفانه شانست نگرفت 😞 دوباره فردا امتحان کن!`);
    }
    userState[userId] = null;
    return;
  }

  // ---- اسکواد: ثبت درخواست ----
  if (data === 'squad_request') {
    userState[userId] = { step: 'squad_name' };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId, 'نام اسکواد خود را وارد کنید:');
  }
  if (data === 'view_squads') {
    const approvedReqs = await getAllSquadReqs({ approved: true });
    if (approvedReqs.length == 0) {
      if (messageId) {
        await bot.editMessageText('هیچ اسکواد فعالی وجود ندارد.', {
          chat_id: userId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }]
            ]
          }
        });
      } else {
        await bot.sendMessage(userId, 'هیچ اسکواد فعالی وجود ندارد.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }]
            ]
          }
        });
      }
      await bot.answerCallbackQuery(query.id);
      return;
    }
    showSquadCard(userId, approvedReqs, 0, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  
  if (data === 'user_details' && userId === adminId) {
  await bot.answerCallbackQuery(query.id);
  // گرفتن همه کاربران
  const usersSnap = await get(ref(db, 'users'));
  if (!usersSnap.exists()) {
    return bot.sendMessage(userId, 'کاربری یافت نشد.');
  }
  const users = usersSnap.val();
  let text = 'لیست کاربران:\n\n';
  for (const [uid, info] of Object.entries(users)) {
    text += `👤 آیدی: ${uid}\nنام کاربری: @${info.username || 'ندارد'}\nامتیاز: ${info.points || 0}\n---\n`;
  }
  await bot.sendMessage(userId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'بازگشت', callback_data: 'panel_back' }]
      ]
    }
  });
  return;
}

  // ---- مدیریت اسکواد: تایید نشده (ادمین) ----
  if (data === 'admin_squad_list' && userId === adminId) {
    const pendingReqs = await getAllSquadReqs({ approved: false });
    if (!pendingReqs.length) {
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'درخواستی برای بررسی وجود ندارد.');
    }
    showAdminSquadCard(userId, pendingReqs, 0);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (data.startsWith('admin_squad_card_') && userId === adminId) {
    const idx = parseInt(data.replace('admin_squad_card_', ''));
    const pendingReqs = await getAllSquadReqs({ approved: false });
    showAdminSquadCard(userId, pendingReqs, idx);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // ---- مدیریت اسکواد: حذف اسکواد تایید شده (ادمین) ----
  if (data === 'admin_delete_approved_squads' && userId === adminId) {
    const approvedReqs = await getAllSquadReqs({ approved: true });
    if (!approvedReqs.length) {
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'اسکواد تاییدشده‌ای برای حذف وجود ندارد.');
    }
    showAdminApprovedSquadCard(userId, approvedReqs, 0);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (data.startsWith('admin_approved_squad_card_') && userId === adminId) {
    const idx = parseInt(data.replace('admin_approved_squad_card_', ''));
    const approvedReqs = await getAllSquadReqs({ approved: true });
    showAdminApprovedSquadCard(userId, approvedReqs, idx);
    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (data.startsWith('admin_delete_approved_squadreq_') && userId === adminId) {
    const reqId = data.replace('admin_delete_approved_squadreq_', '');
    const req = await getSquadReq(reqId);
    if (!req || req.deleted)
      return bot.answerCallbackQuery(query.id, { text: 'اسکواد پیدا نشد یا قبلا حذف شده.', show_alert: true });
    await update(squadReqRef(reqId), { deleted: true });
    await bot.sendMessage(req.user_id, `اسکواد شما توسط مدیریت حذف شد.`);
    await bot.answerCallbackQuery(query.id, { text: 'اسکواد حذف شد.' });
    return;
  }

  // ---- اسکواد: تایید توسط ادمین ----
  if (data.startsWith('approve_squadreq_') && userId === adminId) {
    const reqId = data.replace('approve_squadreq_', '');
    const req = await getSquadReq(reqId);
    if (!req || req.approved || req.deleted)
      return bot.answerCallbackQuery(query.id, { text: 'درخواست معتبر نیست یا قبلا تایید/حذف شده.', show_alert: true });
    await update(squadReqRef(reqId), { approved: true });
    await bot.sendMessage(req.user_id,
      `✅ درخواست شما برای اسکواد «${req.squad_name}» توسط ادمین تایید شد!\n🟢 اکنون درخواست شما برای دیگران نمایش داده خواهد شد.`);
    await bot.answerCallbackQuery(query.id, { text: 'تایید شد و اطلاع‌رسانی گردید.' });
    return;
  }

  // ---- اسکواد: حذف فقط توسط ادمین ----
if (data.startsWith('delete_squadreq_') && userId === adminId) {
  const reqId = data.replace('delete_squadreq_', '');
  const req = await getSquadReq(reqId);
  if (!req || req.deleted)
    return bot.answerCallbackQuery(query.id, { text: 'درخواست پیدا نشد یا قبلا حذف شده.', show_alert: true });
  await update(squadReqRef(reqId), { deleted: true });
  await updatePoints(req.user_id, 5); // پنج سکه به کاربر برگردان
  await bot.sendMessage(req.user_id, `درخواست اسکواد شما توسط مدیریت حذف شد و ۵ سکه به حساب شما بازگردانده شد.`);
  await bot.answerCallbackQuery(query.id, { text: 'درخواست حذف شد و امتیاز بازگردانده شد.' });
  return;
}

  // ---- نمایش کارت اسکواد با ورق‌زنی (عمومی) ----
  if (data.startsWith('squad_card_')) {
    const idx = parseInt(data.replace('squad_card_', ''));
    const reqs = await getAllSquadReqs({ approved: true });
    showSquadCard(userId, reqs, idx, messageId);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // ---- اسکواد: تایید یا لغو ثبت توسط کاربر ----
  if (data === 'cancel_squad_req') {
    userState[userId] = null;
    await bot.answerCallbackQuery(query.id, { text: 'لغو شد.' });
    return bot.sendMessage(userId, 'درخواست لغو شد.');
  }
  if (data === 'confirm_squad_req' && userState[userId] && userState[userId].squad_name) {
    const state = userState[userId];
    // ذخیره در دیتابیس
    const reqRef = push(squadReqsRef);
    const reqId = reqRef.key;
    await set(reqRef, {
      user_id: userId,
      squad_name: state.squad_name,
      roles_needed: state.roles_needed,
      game_id: state.game_id,
      min_rank: state.min_rank,
      details: state.details,
      created_at: Date.now(),
      approved: false,
      deleted: false
    });
    // کسر امتیاز
    await updatePoints(userId, -5);
    userState[userId] = null;
    await bot.answerCallbackQuery(query.id, { text: 'درخواست ثبت شد.' });
    bot.sendMessage(userId, '✅ درخواست شما با موفقیت ثبت شد و به صف بررسی مدیریت اضافه شد.');
    bot.sendMessage(adminId,
      `درخواست جدید اسکواد:\n\nاسکواد: ${state.squad_name}\nکاربر: ${userId}\nآیدی بازی: ${state.game_id}\nرنک: ${state.min_rank}\nنقش: ${state.roles_needed}\nتوضیحات: ${state.details}\n\n`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'تایید ✅', callback_data: `approve_squadreq_${reqId}` },
              { text: 'حذف ❌', callback_data: `delete_squadreq_${reqId}` }
            ]
          ]
        }
      }
    );
    return;
  }

  // ---- محاسبه ریت و برد/باخت و ... ----
  switch (data) {
    case 'calculate_rate':
    case 'calculate_wl':
      if (user.points <= 0) {
        return bot.answerCallbackQuery(query.id, { text: 'شما امتیازی برای استفاده ندارید.', show_alert: true });
      }
      userState[userId] = { type: data === 'calculate_rate' ? 'rate' : 'w/l', step: 'total' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'تعداد کل بازی‌ها را وارد کن:');
    case 'add_points_all':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      userState[userId] = { step: 'add_points_all_enter' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'چه مقدار امتیاز به همه اضافه شود؟ لطفا عدد وارد کنید:');
    case 'referral':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `می‌خوای امتیاز بیشتری بگیری؟ 🎁
لینک اختصاصی خودتو برای دوستات بفرست!
هر کسی که با لینک تو وارد ربات بشه، ۵ امتیاز دائمی می‌گیری ⭐️
لینک دعوت مخصوص شما⬇️:\nhttps://t.me/mlbbratebot?start=${userId}`);
    case 'profile':
      await bot.answerCallbackQuery(query.id);
      const invitesCount = user.invites || 0;
      return bot.sendMessage(userId, `🆔 آیدی عددی: ${userId}\n⭐ امتیاز فعلی: ${user.points}\n📨 تعداد دعوتی‌ها: ${invitesCount}`);
    case 'buy':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, '🎁 برای خرید امتیاز و دسترسی به امکانات بیشتر به پیوی زیر پیام دهید:\n\n📩 @Beast3694');
    case 'support':
      userState[userId] = { step: 'support' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'شما وارد بخش پشتیبانی شده‌اید!\nپیام شما به من فوروارد خواهد شد 📤\nبرای خروج و بازگشت به منوی اصلی، دستور /start را ارسال کنید ⏪');
    case 'help':
      await bot.answerCallbackQuery(query.id);
      const helpText = await getHelpText();
      return bot.sendMessage(userId, helpText);
    case 'add_points':
    case 'sub_points':
      userState[userId] = { step: 'enter_id', type: data === 'add_points' ? 'add' : 'sub' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر را وارد کنید:');
    case 'broadcast':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      userState[userId] = { step: 'broadcast' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'متن پیام همگانی را ارسال کنید یا /cancel برای لغو:');
    case 'ban_user':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      userState[userId] = { step: 'ban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای بن کردن را وارد کنید:');
    case 'unban_user':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      userState[userId] = { step: 'unban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای آن‌بن کردن را وارد کنید:');
    case 'edit_help':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      userState[userId] = { step: 'edit_help' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'متن جدید راهنما را ارسال کنید یا /cancel برای لغو:');
    case 'gift_code':
      userState[userId] = { step: 'enter_gift_code' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'کد هدیه خود را وارد کنید:');
    case 'add_gift_code':
      if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
      userState[userId] = { step: 'add_gift_code_enter_code' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'کد هدیه جدید را وارد کنید:');
    case 'add_global_gift_code':
      if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
      userState[userId] = { step: 'add_global_gift_code_enter_code' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'کد هدیه همگانی جدید را وارد کنید:');
    case 'delete_gift_code':
      if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
      userState[userId] = { step: 'delete_gift_code_enter_code' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'کد هدیه برای حذف را وارد کنید:');
    case 'list_gift_codes':
      if (userId !== adminId) return bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
      const codes = await listGiftCodesCombined();
      if (!codes.length) return bot.sendMessage(userId, 'هیچ کدی وجود ندارد.');
      let msgList = 'لیست همه کدها:\n' + codes.map(c => `کد: ${c.code} (${c.type}) - امتیاز: ${c.points}`).join('\n');
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, msgList);
    case 'bot_stats':
      if (userId !== adminId) {
        await bot.answerCallbackQuery(query.id, { text: 'دسترسی ندارید.', show_alert: true });
        return;
      }
      const snap = await get(ref(db, 'users'));
      const users = snap.exists() ? Object.values(snap.val()) : [];
      const activeUsers = users.filter(u => !u.banned);
      const bannedUsers = users.filter(u => u.banned);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `👥 کاربران کل: ${users.length}\n✅ کاربران فعال: ${activeUsers.length}\n⛔ کاربران بن شده: ${bannedUsers.length}`);
    default:
      await bot.answerCallbackQuery(query.id);
      break;
  }
});

// ---- اداره مراحل ثبت اسکواد ----
// ... ناحیه message handler بدون تغییر، فقط بخش stateهای جدید اضافه شود
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text || '';
  if (!userState[userId] && userId !== adminId) return;
  const user = await getUser(userId);
  
if (!botActive && msg.from.id !== adminId) {
    return bot.sendMessage(msg.from.id, "ربات موقتاً خاموش است.");
  }
  
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده ندارید.');
  }

  // ---- پاسخ به پشتیبانی توسط ادمین ----
  if (msg.reply_to_message && userId === adminId) {
    const replied = msg.reply_to_message;
    const targetUserId = supportChatMap[replied.message_id];
    if (targetUserId) {
      await bot.sendMessage(targetUserId, `پاسخ پشتیبانی:\n${msg.text}`);
      return bot.sendMessage(adminId, '✅ پیام شما به کاربر ارسال شد.');
    }
  }

  const state = userState[userId];
  if (!state) return;
  if (text === '/cancel') {
    userState[userId] = null;
    return bot.sendMessage(userId, 'عملیات لغو شد.', { reply_markup: { remove_keyboard: true } });
  }

  // ---- Panel Admin Steps ----
  if (userId === adminId) {
    switch (state.step) {
      case 'enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        state.targetId = parseInt(text);
        state.step = 'enter_points';
        return bot.sendMessage(userId, 'تعداد امتیاز برای اضافه/کسر کردن را وارد کنید:');
      case 'enter_points':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک عدد معتبر وارد کنید.');
        const pts = parseInt(text);
        if (state.type === 'add') {
          await updatePoints(state.targetId, pts);
          bot.sendMessage(userId, `به کاربر ${state.targetId} مقدار ${pts} امتیاز اضافه شد.`);
        } else if (state.type === 'sub') {
          await updatePoints(state.targetId, -pts);
          bot.sendMessage(userId, `از کاربر ${state.targetId} مقدار ${pts} امتیاز کسر شد.`);
        }
        userState[userId] = null;
        break;
      case 'broadcast':
        userState[userId] = null;
        bot.sendMessage(userId, 'پیام در حال ارسال به همه کاربران...');
        try {
          const snap = await get(ref(db, 'users'));
          const users = snap.exists() ? Object.values(snap.val()) : [];
          const activeUsers = users.filter(u => !u.banned);
          const batchSize = 20;
          for (let i = 0; i < activeUsers.length; i += batchSize) {
            const batch = activeUsers.slice(i, i + batchSize);
            await Promise.all(batch.map(u =>
              bot.sendMessage(u.user_id, `پیام همگانی:\n\n${text}`).catch(() => { })
            ));
            await new Promise(res => setTimeout(res, 1000));
          }
        } catch {
          bot.sendMessage(userId, 'خطا در ارسال پیام همگانی.');
        }
        break;
      case 'ban_enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        const banId = parseInt(text);
        await setBanStatus(banId, true);
        userState[userId] = null;
        return bot.sendMessage(userId, `کاربر ${banId} بن شد.`);
      case 'unban_enter_id':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک آیدی عددی معتبر وارد کنید.');
        const unbanId = parseInt(text);
        await setBanStatus(unbanId, false);
        userState[userId] = null;
        return bot.sendMessage(userId, `کاربر ${unbanId} آن‌بن شد.`);
      case 'edit_help':
        await setHelpText(text);
        userState[userId] = null;
        return bot.sendMessage(userId, 'متن راهنما با موفقیت بروزرسانی شد.');
      case 'add_points_all_enter': {
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک عدد معتبر وارد کنید یا /cancel برای لغو.');
        const amount = parseInt(text);
        try {
          const snap = await get(ref(db, 'users'));
          const users = snap.exists() ? Object.values(snap.val()) : [];
          const activeUsers = users.filter(u => !u.banned);
          for (const u of activeUsers) await updatePoints(u.user_id, amount);
          await bot.sendMessage(userId, `امتیاز ${amount} به همه کاربران فعال اضافه شد. در حال ارسال پیام...`);
          const batchSize = 20;
          for (let i = 0; i < activeUsers.length; i += batchSize) {
            const batch = activeUsers.slice(i, i + batchSize);
            await Promise.all(batch.map(u =>
              bot.sendMessage(u.user_id, `📢 امتیاز ${amount} از طرف پنل مدیریت به حساب همه افزوده شد.`).catch(() => {})
            ));
            await new Promise(res => setTimeout(res, 1000));
          }
          await bot.sendMessage(userId, `پیام به همه کاربران ارسال شد.`);
        } catch (err) {
          await bot.sendMessage(userId, 'خطا در انجام عملیات.');
        }
        userState[userId] = null;
        return;
      }
      case 'add_gift_code_enter_code':
        state.code = text.trim();
        state.step = 'add_gift_code_enter_points';
        return bot.sendMessage(userId, 'مقدار امتیاز برای این کد را وارد کنید:');
      case 'add_gift_code_enter_points':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک عدد معتبر وارد کنید.');
        const points = parseInt(text);
        await upsertGiftCode(state.code, points);
        userState[userId] = null;
        return bot.sendMessage(userId, `کد با موفقیت اضافه شد: ${state.code} (${points} امتیاز)`);
      case 'add_global_gift_code_enter_code':
        state.code = text.trim();
        state.step = 'add_global_gift_code_enter_points';
        return bot.sendMessage(userId, 'مقدار امتیاز برای این کد همگانی را وارد کنید:');
      case 'add_global_gift_code_enter_points':
        if (!/^\d+$/.test(text)) return bot.sendMessage(userId, 'لطفا یک عدد معتبر وارد کنید.');
        const gpoints = parseInt(text);
        await upsertGlobalGiftCode(state.code, gpoints);
        userState[userId] = null;
        return bot.sendMessage(userId, `کد همگانی با موفقیت اضافه شد: ${state.code} (${gpoints} امتیاز)`);
      case 'delete_gift_code_enter_code':
        const code = text.trim();
        await deleteGiftCode(code);
        await deleteGlobalGiftCode(code);
        userState[userId] = null;
        return bot.sendMessage(userId, `کد ${code} (در صورت وجود) حذف شد.`);
    }
  }

  // ---- User steps for calculations ----
  if (state.step === 'total') {
    const total = parseInt(text);
    if (isNaN(total) || total <= 0) return bot.sendMessage(userId, 'تعداد کل بازی‌ها را به صورت عدد مثبت وارد کن.');
    state.total = total;
    state.step = 'rate';
    return bot.sendMessage(userId, 'ریت فعلی را وارد کن (مثلاً 55):');
  }
  if (state.step === 'rate') {
    const rate = parseFloat(text);
    if (isNaN(rate) || rate < 0 || rate > 100) return bot.sendMessage(userId, 'درصد ریت را به صورت عدد بین 0 تا 100 وارد کن.');
    if (state.type === 'rate') {
      state.rate = rate;
      state.step = 'target';
      return bot.sendMessage(userId, 'ریت هدف را وارد کن:');
    } else {
      const wins = Math.round((state.total * rate) / 100);
      const losses = state.total - wins;
      await updatePoints(userId, -1);
      userState[userId] = null;
      bot.sendMessage(userId, `برد: ${wins} | باخت: ${losses}\nامتیاز باقی‌مانده: ${user.points - 1}`);
      sendMainMenu(userId);
    }
  }
  if (state.step === 'target') {
    const target = parseFloat(text);
    if (isNaN(target) || target < 0 || target > 100) return bot.sendMessage(userId, 'ریت هدف را به صورت عدد بین 0 تا 100 وارد کن.');
    const currentWins = (state.total * state.rate) / 100;
    const neededWins = Math.ceil(((target / 100 * state.total) - currentWins) / (1 - target / 100));
    await updatePoints(userId, -1);
    userState[userId] = null;
    bot.sendMessage(userId, `برای رسیدن به ${target}% باید ${neededWins} بازی متوالی ببری.\nامتیاز باقی‌مانده: ${user.points - 1}`);
    sendMainMenu(userId);
  }
  if (state.step === 'support') {
    if (msg.message_id && text.length > 0) {
      try {
        const adminMsg = await bot.forwardMessage(adminId, userId, msg.message_id);
        supportChatMap[adminMsg.message_id] = userId;
        return bot.sendMessage(userId, 'پیام شما ارسال شد. برای خروج /start را بزنید.');
      } catch {
        return bot.sendMessage(userId, 'ارسال پیام با خطا مواجه شد.');
      }
    }
  }
  if (state.step === 'enter_gift_code') {
    const code = text.trim();
    let points = await getGiftCode(code);
    if (points) {
      await deleteGiftCode(code);
      await updatePoints(userId, points);
      userState[userId] = null;
      bot.sendMessage(userId, `تبریک! کد با موفقیت فعال شد و ${points} امتیاز به حساب شما افزوده شد.`);
      sendMainMenu(userId);
      return;
    }
    const globalGift = await getGlobalGiftCode(code);
    if (globalGift) {
      const usersUsed = globalGift.users_used || {};
      if (usersUsed[userId]) {
        userState[userId] = null;
        return bot.sendMessage(userId, 'شما قبلاً از این کد همگانی استفاده کرده‌اید.');
      }
      await addUserToGlobalGiftCode(code, userId);
      await updatePoints(userId, globalGift.points);
      userState[userId] = null;
      bot.sendMessage(userId, `کد همگانی فعال شد و ${globalGift.points} امتیاز به حساب شما اضافه شد.`);
      sendMainMenu(userId);
      return;
    }
    userState[userId] = null;
    return bot.sendMessage(userId, 'کد نامعتبر است یا منقضی شده است.');
  }

  // ---- اداره مراحل ثبت اسکواد ----
  if (state.step === 'squad_name') {
    state.squad_name = text;
    state.step = 'squad_roles';
    return bot.sendMessage(userId, 'چه رولی نیاز دارید؟ (مثال: تانک، ساپورت...)');
  }
  if (state.step === 'squad_roles') {
    state.roles_needed = text;
    state.step = 'game_id';
    return bot.sendMessage(userId, 'آیدی تلگرام لیدر');
  }
  if (state.step === 'game_id') {
    state.game_id = text;
    state.step = 'min_rank';
    return bot.sendMessage(userId, 'حداقل رنک مورد نیاز؟');
  }
  if (state.step === 'min_rank') {
    state.min_rank = text;
    state.step = 'details';
    return bot.sendMessage(userId, 'توضیحات (اختیاری):');
  }
  if (state.step === 'details') {
    state.details = text;
    if ((user.points || 0) < 5) {
      userState[userId] = null;
      return bot.sendMessage(userId, 'برای ثبت درخواست باید حداقل ۵ امتیاز داشته باشید.');
    }
    userState[userId] = { step: 'confirm_squad_req', ...state };
    return bot.sendMessage(userId,
      `درخواست شما:\n\nاسکواد: ${state.squad_name}\nنقش مورد نیاز: ${state.roles_needed}\nآیدی تلگرام لیدر: ${state.game_id}\nحداقل رنک: ${state.min_rank}\nتوضیحات: ${state.details}\n\nبا ثبت درخواست ۵ امتیاز از شما کسر می‌شود. تایید می‌کنید؟`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ثبت نهایی ✅', callback_data: 'confirm_squad_req' }],
            [{ text: 'انصراف ❌', callback_data: 'cancel_squad_req' }]
          ]
        }
      }
    );
  }
});

// ---- نمایش کارت اسکواد با ورق‌زنی (عمومی) ----
async function showSquadCard(userId, reqs, idx, messageId) {
  if (reqs.length === 0) {
    if (messageId) {
      return bot.editMessageText('هیچ اسکوادی وجود ندارد.', {
        chat_id: userId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }]
          ]
        }
      });
    } else {
      return bot.sendMessage(userId, 'هیچ اسکوادی وجود ندارد.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }]
          ]
        }
      });
    }
  }
  if (idx < 0) idx = 0;
  if (idx >= reqs.length) idx = reqs.length - 1;
  const req = reqs[idx];
let txt = `🎯 اسکواد: ${req.squad_name}\n🎭نقش مورد نیاز: ${req.roles_needed}\n👤آیدی تاگرام لیدر: ${req.game_id || '-'}\n🏅رنک: ${req.min_rank}\n📝توضیحات: ${req.details}\n`;
  txt += `\n🖌️درخواست‌دهنده: ${req.user_id}`;
  let buttons = [];
  if (reqs.length > 1) {
    buttons = [
      { text: '⬅️', callback_data: `squad_card_${idx - 1}` },
      { text: 'بازگشت 🔙', callback_data: 'main_menu' },
      { text: '➡️', callback_data: `squad_card_${idx + 1}` }
    ];
  } else {
    buttons = [{ text: 'بازگشت 🔙', callback_data: 'main_menu' }];
  }

  if (messageId) {
    bot.editMessageText(txt, {
      chat_id: userId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [buttons]
      }
    });
  } else {
    bot.sendMessage(userId, txt, {
      reply_markup: {
        inline_keyboard: [buttons]
      }
    });
  }
}

// ---- نمایش کارت اسکواد ادمین با ورق‌زنی و دکمه تایید/حذف ----
async function showAdminSquadCard(userId, reqs, idx) {
  if (reqs.length === 0)
    return bot.sendMessage(userId, 'درخواستی وجود ندارد.');
  if (idx < 0) idx = 0;
  if (idx >= reqs.length) idx = reqs.length - 1;
  const req = reqs[idx];
let txt = `🎯 اسکواد: ${req.squad_name}\n🎭نقش مورد نیاز: ${req.roles_needed}\n👤آیدی تاگرام لیدر: ${req.game_id || '-'}\n🏅رنک: ${req.min_rank}\n📝توضیحات: ${req.details}\n`;
  txt += `\n🖌️درخواست‌دهنده: ${req.user_id}`;
  const navBtns = [];
  if (idx > 0) navBtns.push({ text: '⬅️ قبلی', callback_data: `admin_squad_card_${idx - 1}` });
  if (idx < reqs.length - 1) navBtns.push({ text: 'بعدی ➡️', callback_data: `admin_squad_card_${idx + 1}` });
  const actionBtns = [
    { text: 'تایید ✅', callback_data: `approve_squadreq_${req.id}` },
    { text: 'حذف ❌', callback_data: `delete_squadreq_${req.id}` }
  ];
  bot.sendMessage(userId, txt, {
    reply_markup: {
      inline_keyboard: [actionBtns, navBtns.length ? navBtns : []]
    }
  });
}

// ---- نمایش کارت اسکواد تایید شده برای حذف توسط ادمین ----
async function showAdminApprovedSquadCard(userId, reqs, idx) {
  if (reqs.length === 0)
    return bot.sendMessage(userId, 'اسکواد تاییدشده‌ای وجود ندارد.');
  if (idx < 0) idx = 0;
  if (idx >= reqs.length) idx = reqs.length - 1;
  const req = reqs[idx];
let txt = `🎯 اسکواد: ${req.squad_name}\n🎭نقش مورد نیاز: ${req.roles_needed}\n👤آیدی تاگرام لیدر: ${req.game_id || '-'}\n🏅رنک: ${req.min_rank}\n📝توضیحات: ${req.details}\n`;
  txt += `\n🖌️درخواست‌دهنده: ${req.user_id}`;
  const navBtns = [];
  if (idx > 0) navBtns.push({ text: '⬅️ قبلی', callback_data: `admin_approved_squad_card_${idx - 1}` });
  if (idx < reqs.length - 1) navBtns.push({ text: 'بعدی ➡️', callback_data: `admin_approved_squad_card_${idx + 1}` });
  const actionBtns = [
    { text: '🗑 حذف اسکواد', callback_data: `admin_delete_approved_squadreq_${req.id}` }
  ];
  bot.sendMessage(userId, txt, {
    reply_markup: {
      inline_keyboard: [actionBtns, navBtns.length ? navBtns : []]
    }
  });
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

})();