const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const adminId = 381183017;
const webhookUrl = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 10000;

// وبهوک => polling باید false باشه
const bot = new TelegramBot(token, { polling: false });

// ست کردن وبهوک روی URL صحیح
bot.setWebHook(`${webhookUrl}/bot${token}`);

// برای خواندن JSON های ارسالی تلگرام
app.use(express.json());

// دریافت آپدیت‌ها از تلگرام و پردازش آنها
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const db = new sqlite3.Database('./botdata.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    points INTEGER DEFAULT 5,
    invites INTEGER DEFAULT 0
  )`);
});

const userState = {};

function ensureUser(user) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [user.id, user.username || '']);
}

function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function updatePoints(userId, amount) {
  db.run(`UPDATE users SET points = points + ? WHERE user_id = ?`, [amount, userId]);
}

bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1];
  ensureUser(msg.from);

  if (refId && parseInt(refId) !== userId) {
    const existingUser = await getUser(userId);
    if (existingUser && existingUser.invites === 0) {
      updatePoints(refId, 5);
      db.run(`UPDATE users SET invites = invites + 1 WHERE user_id = ?`, [refId]);
      db.run(`UPDATE users SET invites = 1 WHERE user_id = ?`, [userId]); // اضافه: جلوگیری از تکرار امتیاز دادن
    }
  }

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
          { text: 'خرید امتیاز', callback_data: 'buy' }
        ]
      ]
    }
  };

  bot.sendMessage(userId, 'به ربات خوش آمدید. یکی از گزینه‌ها را انتخاب کنید.', keyboard);
});

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const user = await getUser(userId);
  if (!user) return;

  if (data === 'calculate_rate' || data === 'calculate_wl') {
    if (user.points <= 0) return bot.sendMessage(userId, 'شما امتیازی برای استفاده ندارید.');
    updatePoints(userId, -1);
    userState[userId] = {
      type: data === 'calculate_rate' ? 'rate' : 'w/l',
      step: 'total'
    };
    return bot.sendMessage(userId, 'تعداد کل بازی‌ها را وارد کن:');
  }

  if (data === 'referral') {
    return bot.sendMessage(userId, `لینک دعوت اختصاصی شما:\nhttps://t.me/mlbbratebot?start=${userId}`);
  }

  if (data === 'profile') {
    return bot.sendMessage(userId, `آیدی عددی: ${userId}\nامتیاز باقی‌مانده: ${user.points}\nتعداد دعوتی‌ها: ${user.invites}`);
  }

  if (data === 'buy') {
    return bot.sendMessage(userId, 'برای خرید امتیاز به پیوی @Beast3694 مراجعه کنید.');
  }

  if (data === 'admin_panel' && userId === adminId) {
    return bot.sendMessage(userId, 'انتخاب کن:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ افزودن امتیاز', callback_data: 'add_points' },
            { text: '➖ کسر امتیاز', callback_data: 'sub_points' }
          ],
          [
            { text: '📢 پیام همگانی', callback_data: 'broadcast' }
          ]
        ]
      }
    });
  }

  if (data === 'add_points' || data === 'sub_points') {
    userState[userId] = { step: 'enter_id', type: data === 'add_points' ? 'add' : 'sub' };
    return bot.sendMessage(userId, 'آیدی عددی کاربر را وارد کنید:');
  }

  if (data === 'broadcast') {
    userState[userId] = { step: 'broadcast' };
    return bot.sendMessage(userId, 'متن پیام همگانی را ارسال کنید:');
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;
  ensureUser(msg.from);
  const state = userState[userId];

  if (state) {
    if (state.step === 'total') {
      const total = parseInt(text);
      if (isNaN(total)) return bot.sendMessage(userId, 'تعداد کل بازی‌ها را به صورت عدد وارد کن.');
      state.total = total;
      state.step = 'rate';
      return bot.sendMessage(userId, 'ریت فعلی را وارد کن (مثلاً 55):');
    }

    if (state.step === 'rate') {
      const rate = parseFloat(text);
      if (isNaN(rate)) return bot.sendMessage(userId, 'درصد ریت را به صورت عدد وارد کن.');
      if (state.type === 'rate') {
        state.rate = rate;
        state.step = 'target';
        return bot.sendMessage(userId, 'ریت هدف را وارد کن:');
      } else {
        const wins = Math.round((state.total * rate) / 100);
        const losses = state.total - wins;
        bot.sendMessage(userId, `برد: ${wins} | باخت: ${losses}`);
        delete userState[userId];
      }
    }

    if (state.step === 'target') {
      const target = parseFloat(text);
      if (isNaN(target)) return bot.sendMessage(userId, 'ریت هدف را به صورت عدد وارد کن.');
      const currentWins = (state.total * state.rate) / 100;
      const x = Math.ceil(((target / 100 * state.total) - currentWins) / (1 - target / 100));
      bot.sendMessage(userId, `برای رسیدن به ${target}% باید ${x} بازی متوالی ببری.`);
      delete userState[userId];
    }

    if (state.step === 'enter_id') {
      const targetId = parseInt(text);
      if (isNaN(targetId)) return bot.sendMessage(userId, 'آیدی عددی نامعتبر است.');
      state.targetId = targetId;
      state.step = 'enter_amount';
      return bot.sendMessage(userId, 'مقدار امتیاز را وارد کنید:');
    }

    if (state.step === 'enter_amount') {
      const amount = parseInt(text);
      if (isNaN(amount)) return bot.sendMessage(userId, 'عدد وارد کن.');
      updatePoints(state.targetId, state.type === 'add' ? amount : -amount);
      bot.sendMessage(userId, 'انجام شد.');
      delete userState[userId];
    }

    if (state.step === 'broadcast') {
      db.all(`SELECT user_id FROM users`, [], (err, rows) => {
        if (!err) {
          rows.forEach(row => {
            bot.sendMessage(row.user_id, text).catch(() => {});
          });
        }
      });
      bot.sendMessage(userId, 'پیام همگانی ارسال شد.');
      delete userState[userId];
    }

    return;
  }

  if (userId === adminId && text === '/panel') {
    return bot.sendMessage(userId, 'ورود به پنل ادمین:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'ورود به پنل', callback_data: 'admin_panel' }]]
      }
    });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
