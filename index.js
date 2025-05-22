require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, update, remove } = require('firebase/database');

const app = express();

const token = process.env.BOT_TOKEN;
const adminId = Number(process.env.ADMIN_ID);
const webhookUrl = process.env.WEBHOOK_URL;
const port = process.env.PORT || 10000;

// ---- Firebase Config ----
const firebaseConfig = {
  databaseURL: process.env.DATABASE_URL,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ---- Helper Functions ----
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
const giftCodeRef = code => ref(db, `gift_codes/${code}`);
const globalGiftCodeRef = code => ref(db, `global_gift_codes/${code}`);
const settingsRef = key => ref(db, `settings/${key}`);
async function getHelpText() {
  const snap = await get(settingsRef('help_text'));
  return snap.exists() ? snap.val() : 'متن راهنما موجود نیست.';
}
async function setHelpText(newText) {
  await set(settingsRef('help_text'), newText);
}
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
const supportChatMap = {}; // { adminMsgId: userId }

// ---- Main Menu ----
function sendMainMenu(userId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊محاسبه ریت', callback_data: 'calculate_rate' },
          { text: '🏆محاسبه برد/باخت', callback_data: 'calculate_wl' }
        ],
        [
          { text: '🔗دعوت دوستان', callback_data: 'referral' },
          { text: '👤 پروفایل', callback_data: 'profile' }
        ],
        [
          { text: '💬پشتیبانی', callback_data: 'support' }
        ],
        [
          { text: '📚راهنما', callback_data: 'help' }
        ],
        [
           { text: '🎁خرید امتیاز', callback_data: 'buy' }
        ],
        [
          { text: '🍀 شانس', callback_data: 'chance' },
          { text: '🎁 کد هدیه', callback_data: 'gift_code' }
        ]
      ]
    }
  };
  bot.sendMessage(userId, 'سلام، به ربات محاسبه‌گر Mobile Legends خوش آمدید ✨', keyboard);
}

// ---- Bot Initialization ----
const bot = new TelegramBot(token, { polling: false });
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ---- /start with referral ----
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;

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

// ---- /panel for admin ----
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
          { text: '🗑 حذف کد هدیه', callback_data: 'delete_gift_code' }
        ],
        [
          { text: '🎁 ساخت کد هدیه همگانی', callback_data: 'add_global_gift_code' }
        ],
        [
          { text: '📜 لیست همه کدها', callback_data: 'list_gift_codes' },
          { text: '📊 آمار ربات', callback_data: 'bot_stats' }
        ]
      ]
    }
  });
});

// ---- CALLBACK QUERIES ----
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;

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

  const user = await getUser(userId);
  if (!user) return await bot.answerCallbackQuery(query.id, { text: 'خطا در دریافت اطلاعات کاربر.', show_alert: true });
  if (user?.banned) return await bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید و اجازه استفاده ندارید.', show_alert: true });

  // ---- آمار ربات ----
  if (data === 'bot_stats' && userId === adminId) {
    const usersSnap = await get(ref(db, 'users'));
    const users = usersSnap.exists() ? Object.values(usersSnap.val()) : [];
    const totalUsers = users.length;
    const bannedUsers = users.filter(u => u.banned).length;
    const codesSnap = await get(ref(db, 'gift_codes'));
    const codes = codesSnap.exists() ? Object.keys(codesSnap.val()) : [];
    const globalSnap = await get(ref(db, 'global_gift_codes'));
    const gCodes = globalSnap.exists() ? Object.keys(globalSnap.val()) : [];
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId, `📊 آمار ربات:\n👥 کاربران کل: ${totalUsers}\n⛔ کاربران بن شده: ${bannedUsers}\n🎁 کد هدیه یک‌بارمصرف: ${codes.length}\n🎁 کد هدیه همگانی: ${gCodes.length}`);
  }

  // ---- ساخت کد هدیه همگانی ----
  if (data === 'add_global_gift_code' && userId === adminId) {
    userState[userId] = { step: 'add_global_gift_code_enter_code' };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId, 'کد هدیه همگانی جدید را وارد کنید:');
  }

  // ---- شانس (لایسنس بی‌نهایت برای adminId) ----
  if (data === 'chance') {
    const now = Date.now();
    const lastUse = user.last_chance_use || 0;
    if (userId !== adminId && now - lastUse < 24*60*60*1000) {
      const hoursLeft = Math.ceil((24*60*60*1000 - (now - lastUse)) / (60*60*1000));
      await bot.answerCallbackQuery(query.id, { text: `شما تا ${hoursLeft} ساعت دیگر نمی‌توانید دوباره شانس خود را امتحان کنید.`, show_alert: true });
      return;
    }
    userState[userId] = { step: 'chance_select' };
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(userId,
      `🍀 شانست رو انتخاب کن!\n\n
🎲 اگر تاس بندازی و ۶ بیاد: ۲ امتیاز می‌گیری
⚽ اگر پنالتی بزنی و گل بشه (GOAL): ۱ امتیاز می‌گیری
🎯 اگر دارت بزنی و وسط هدف (BULLSEYE) بزنی: ۱ امتیاز می‌گیری

یک گزینه رو انتخاب کن:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎲 تاس', callback_data: 'chance_dice' },
              { text: '⚽ پنالتی', callback_data: 'chance_football' },
              { text: '🎯 دارت', callback_data: 'chance_dart' }
            ]
          ]
        }
      }
    );
  }

  if (['chance_dice','chance_football','chance_dart'].includes(data)) {
    if (userState[userId]?.step !== 'chance_select') {
      await bot.answerCallbackQuery(query.id);
      return;
    }
    const now = Date.now();
    const lastUse = user.last_chance_use || 0;
    if (userId !== adminId && now - lastUse < 24*60*60*1000) {
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

  // ---- سایر دکمه‌ها ----
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
    default:
      await bot.answerCallbackQuery(query.id);
      break;
  }
});

// ---- MESSAGE HANDLER ----
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text || '';
  if (!userState[userId] && userId !== adminId) return;
  const user = await getUser(userId);

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
              bot.sendMessage(u.user_id, `📢 امتیاز ${amount} از طرف پنل مدیریت به حساب شما افزوده شد.`).catch(() => {})
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
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
