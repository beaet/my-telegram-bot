const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const adminId = 381183017;
const webhookUrl = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 10000;

// وبهوک (polling: false)
const bot = new TelegramBot(token, { polling: false });
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// راه‌اندازی دیتابیس
const db = new sqlite3.Database('./botdata.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    points INTEGER DEFAULT 5,
    invites INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['help_text', 'متن پیش‌فرض راهنما']);
    }
  });
});

// وضعیت کاربران در حافظه برای مراحل
const userState = {};

// تابع ذخیره یا اطمینان از وجود کاربر
function ensureUser(user) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [user.id, user.username || '']);
}

// گرفتن کاربر از دیتابیس
function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// بروزرسانی امتیاز کاربر (اضافه یا کم)
function updatePoints(userId, amount) {
  db.run(`UPDATE users SET points = points + ? WHERE user_id = ?`, [amount, userId]);
}

// تغییر وضعیت بن کاربر
function setBanStatus(userId, status) {
  db.run(`UPDATE users SET banned = ? WHERE user_id = ?`, [status ? 1 : 0, userId]);
}

// گرفتن متن راهنما از دیتابیس
function getHelpText() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'help_text'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : 'متن راهنما موجود نیست.');
    });
  });
}

// ذخیره متن راهنما
function setHelpText(newText) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('help_text', ?)`, [newText]);
}

// پاک کردن وضعیت کاربر
function resetUserState(userId) {
  delete userState[userId];
}

// ارسال منوی اصلی (یکبار فقط)
function sendMainMenu(userId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'محاسبه ریت', callback_data: 'calculate_rate' },
          { text: 'محاسبه برد/باخت', callback_data: 'calculate_wl' }
        ],
        [
          { text: 'دریافت لینک دعوت', callback_data: 'referral' },
          { text: 'حساب کاربری', callback_data: 'profile' }
        ],
        [
          { text: 'پشتیبانی', callback_data: 'support' }
        ],
        [
          { text: 'راهنما', callback_data: 'help' }
        ],
        [
          { text: 'خرید امتیاز', callback_data: 'buy' }
        ]
      ]
    }
  };

  bot.sendMessage(userId, 'به ربات خوش آمدید. یکی از گزینه‌ها را انتخاب کنید.', keyboard);
}

// هنگام دستور /start
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1] ? parseInt(match[1]) : null;

  ensureUser(msg.from);
  const user = await getUser(userId);
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده از ربات را ندارید.');
  }

  resetUserState(userId);

  // مدیریت دعوت
  if (refId && refId !== userId) {
    db.get(`SELECT invites FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (row && row.invites === 0) {
        updatePoints(refId, 5);
        db.run(`UPDATE users SET invites = invites + 1 WHERE user_id = ?`, [refId]);
        db.run(`UPDATE users SET invites = 1 WHERE user_id = ?`, [userId]);
      }
    });
  }

  sendMainMenu(userId);
});

// فقط دستور /panel برای پنل مدیریت
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
          { text: 'بن کردن کاربر', callback_data: 'ban_user' },
          { text: 'آن‌بن کردن کاربر', callback_data: 'unban_user' }
        ],
        [
          { text: 'تغییر متن راهنما', callback_data: 'edit_help' }
        ]
      ]
    }
  });
});

// هندل دکمه‌ها
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const user = await getUser(userId);
  if (!user) return bot.answerCallbackQuery(query.id);

  if (user.banned) {
    return bot.answerCallbackQuery(query.id, { text: 'شما بن شده‌اید.', show_alert: true });
  }

  switch (data) {
    case 'calculate_rate':
    case 'calculate_wl':
      if (user.points <= 0) {
        return bot.answerCallbackQuery(query.id, { text: 'شما امتیازی برای استفاده ندارید.', show_alert: true });
      }
      userState[userId] = {
        type: data === 'calculate_rate' ? 'rate' : 'w/l',
        step: 'total'
      };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'تعداد کل بازی‌ها را وارد کن:');

    case 'referral':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `لینک دعوت اختصاصی شما:\nhttps://t.me/mlbbratebot?start=${userId}`);

    case 'profile':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, `آیدی عددی: ${userId}\nامتیاز باقی‌مانده: ${user.points}\nتعداد دعوتی‌ها: ${user.invites}`);

    case 'buy':
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'برای خرید امتیاز به پیوی @Beast3694 مراجعه کنید.');

    case 'support':
      userState[userId] = { step: 'support' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'شما در بخش پشتیبانی هستید. هر پیام شما به من فوروارد خواهد شد. برای خروج /start بزنید.');

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
      userState[userId] = { step: 'broadcast' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'متن پیام همگانی را ارسال کنید یا /cancel برای لغو:');

    case 'ban_user':
      userState[userId] = { step: 'ban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای بن کردن را وارد کنید:');

    case 'unban_user':
      userState[userId] = { step: 'unban_enter_id' };
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(userId, 'آیدی عددی کاربر برای آن‌بن کردن را وارد کنید:');

    case 'edit_help':
  userState[userId] = { step: 'edit_help' };
  await bot.answerCallbackQuery(query.id);
  return bot.sendMessage(userId, 'متن جدید راهنما را ارسال کنید یا /cancel برای لغو:');
}

// پاسخ به پیام‌ها برای مراحل مختلف
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;

  if (!userState[userId]) return; // اگر در مرحله‌ای نبود، کاری نکن

  // اگر کاربر بن شده باشد
  const user = await getUser(userId);
  if (user?.banned) {
    return bot.sendMessage(userId, 'شما بن شده‌اید و اجازه استفاده ندارید.');
  }

  const state = userState[userId];

  if (text === '/cancel') {
    resetUserState(userId);
    return bot.sendMessage(userId, 'عملیات لغو شد.', { reply_markup: { remove_keyboard: true } });
  }

  switch (state.step) {
    case 'total':
      if (!/^\d+$/.test(text)) {
        return bot.sendMessage(userId, 'لطفاً فقط عدد وارد کنید.');
      }
      state.total = parseInt(text);
      if (state.type === 'rate') {
        state.step = 'current_rate';
        return bot.sendMessage(userId, 'ریت فعلی خود را وارد کنید (مثلاً 45):');
      } else if (state.type === 'w/l') {
        state.step = 'wins';
        return bot.sendMessage(userId, 'تعداد بردهای متوالی را وارد کنید:');
      }
      break;

    case 'current_rate':
      if (!/^\d+$/.test(text)) {
        return bot.sendMessage(userId, 'لطفاً فقط عدد وارد کنید.');
      }
      state.currentRate = parseInt(text);
      state.step = 'target_rate';
      return bot.sendMessage(userId, 'ریت هدف را وارد کنید:');

    case 'target_rate':
      if (!/^\d+$/.test(text)) {
        return bot.sendMessage(userId, 'لطفاً فقط عدد وارد کنید.');
      }
      const targetRate = parseInt(text);
      if (targetRate <= state.currentRate) {
        return bot.sendMessage(userId, 'ریت هدف باید بزرگ‌تر از ریت فعلی باشد.');
      }

      // محاسبه تعداد برد متوالی لازم برای رسیدن به ریت هدف
      const x = Math.ceil((state.total * targetRate - state.total * state.currentRate) / (100 - targetRate));
      bot.sendMessage(userId, `برای رسیدن به ریت ${targetRate}% باید حدود ${x} بازی متوالی ببری.`);

      // کم کردن امتیاز فقط وقتی پاسخ کامل شد
      updatePoints(userId, -1);

      resetUserState(userId);
      break;

    case 'wins':
      if (!/^\d+$/.test(text)) {
        return bot.sendMessage(userId, 'لطفاً فقط عدد وارد کنید.');
      }
      state.wins = parseInt(text);
      state.step = 'losses';
      return bot.sendMessage(userId, 'تعداد باخت‌های متوالی را وارد کنید:');

    case 'losses':
      if (!/^\d+$/.test(text)) {
        return bot.sendMessage(userId, 'لطفاً فقط عدد وارد کنید.');
      }
      const wins = state.wins;
      const losses = parseInt(text);

      if (wins + losses > state.total) {
        return bot.sendMessage(userId, 'جمع برد و باخت نمی‌تواند بیشتر از تعداد کل بازی‌ها باشد.');
      }

      // محاسبه ریت جدید
      const newRate = Math.round(((wins * 100) / (wins + losses)) * 100) / 100;
      bot.sendMessage(userId, `رتبه شما بعد از ${wins} برد و ${losses} باخت متوالی حدود ${newRate}% خواهد بود.`);

      updatePoints(userId, -1);

      resetUserState(userId);
      break;

    case 'enter_id':
      const targetId = parseInt(text);
      if (isNaN(targetId)) {
        return bot.sendMessage(userId, 'آیدی باید عدد باشد. دوباره وارد کنید:');
      }
      state.targetId = targetId;
      state.step = 'enter_points';
      return bot.sendMessage(userId, 'مقدار امتیاز را وارد کنید:');

    case 'enter_points':
      const pts = parseInt(text);
      if (isNaN(pts)) {
        return bot.sendMessage(userId, 'عدد صحیح وارد کنید:');
      }

      getUser(state.targetId).then(targetUser => {
        if (!targetUser) {
          bot.sendMessage(userId, 'کاربر با این آیدی یافت نشد.');
          resetUserState(userId);
          return;
        }

        if (state.type === 'add') {
          updatePoints(state.targetId, pts);
          bot.sendMessage(userId, `به کاربر ${state.targetId}، ${pts} امتیاز اضافه شد.`);
        } else {
          if (targetUser.points < pts) {
            bot.sendMessage(userId, 'کاربر امتیاز کافی ندارد.');
          } else {
            updatePoints(state.targetId, -pts);
            bot.sendMessage(userId, `از کاربر ${state.targetId}، ${pts} امتیاز کسر شد.`);
          }
        }
        resetUserState(userId);
      });
      break;

    case 'broadcast':
      const broadcastText = text;
      bot.sendMessage(userId, 'در حال ارسال پیام همگانی...');
      db.all(`SELECT user_id FROM users WHERE banned = 0`, (err, rows) => {
        if (err) {
          bot.sendMessage(userId, 'خطا در ارسال پیام همگانی.');
          resetUserState(userId);
          return;
        }
        rows.forEach(row => {
          bot.sendMessage(row.user_id, broadcastText).catch(() => {});
        });
        bot.sendMessage(userId, 'پیام همگانی ارسال شد.');
       resetUserState(userId);
     });
     break;

   case 'ban_enter_id':
     const banId = parseInt(text);
     if (isNaN(banId)) {
       return bot.sendMessage(userId, 'آیدی عددی معتبر وارد کنید:');
     }
     getUser(banId).then(targetUser => {
       if (!targetUser) {
         bot.sendMessage(userId, 'کاربر یافت نشد.');
       } else {
         setBanStatus(banId, true);
         bot.sendMessage(userId, `کاربر ${banId} بن شد.`);
       }
       resetUserState(userId);
     });
     break;

   case 'unban_enter_id':
     const unbanId = parseInt(text);
     if (isNaN(unbanId)) {
       return bot.sendMessage(userId, 'آیدی عددی معتبر وارد کنید:');
     }
     getUser(unbanId).then(targetUser => {
       if (!targetUser) {
         bot.sendMessage(userId, 'کاربر یافت نشد.');
       } else {
         setBanStatus(unbanId, false);
         bot.sendMessage(userId, `کاربر ${unbanId} آن‌بن شد.`);
       }
       resetUserState(userId);
     });
     break;

   case 'edit_help':
     setHelpText(text);
     bot.sendMessage(userId, 'متن راهنما با موفقیت بروزرسانی شد.');
     resetUserState(userId);
     break;
 }
});

       app.listen(port, () => {
  console.log(`Bot server is running on port ${port}`);
});
