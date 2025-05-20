const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const token = '8129314550:AAFQTvL8VVg-4QtQD8QLY03LCWiSP1uaCak';
const adminId = 381183017;
const webhookUrl = 'https://my-telegram-bot-albl.onrender.com';
const port = process.env.PORT || 3000;

// تنظیم وبهوک
const bot = new TelegramBot(token);
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());

// وبهوک برای دریافت آپدیت‌ها
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// دیتابیس
const db = new sqlite3.Database('./botdata.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    points INTEGER DEFAULT 5,
    invites INTEGER DEFAULT 0
  )`);
});

// حالت کاربر
const userState = {};

// افزودن کاربر جدید در صورت نبودن
function ensureUser(user) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [user.id, user.username || '']);
}

// گرفتن اطلاعات کاربر
function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// آپدیت امتیاز کاربر
function updatePoints(userId, amount) {
  db.run(`UPDATE users SET points = points + ? WHERE user_id = ?`, [amount, userId]);
}

// فرمان استارت و پردازش دعوت
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const refId = match[1];
  ensureUser(msg.from);

  if (refId && parseInt(refId) !== userId) {
    const user = await getUser(userId);
    if (user && user.invites === 0) {
      updatePoints(parseInt(refId), 5);
      db.run(`UPDATE users SET invites = invites + 1 WHERE user_id = ?`, [parseInt(refId)]);
    }
  }

  const keyboard = {
    reply_markup: {
      keyboard: [
        ['محاسبه ریت', 'محاسبه برد/باخت'],
        ['دریافت لینک دعوت', 'حساب کاربری']
      ],
      resize_keyboard: true
    }
  };

  bot.sendMessage(userId, 'به ربات خوش آمدید. یکی از گزینه‌ها را انتخاب کنید.', keyboard);
});

// دریافت پیام‌های کاربر
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;
  ensureUser(msg.from);

  const user = await getUser(userId);
  if (!user) return;

  // اگر کاربر در حالت خاصی است (مثلا در فرآیند محاسبه)
  if (userState[userId]) {
    const state = userState[userId];

    if (state.step === 'total') {
      const total = parseInt(text);
      if (isNaN(total)) return bot.sendMessage(userId, 'تعداد کل بازی‌ها را به صورت عدد وارد کن.');
      state.total = total;
      state.step = 'rate';
      return bot.sendMessage(userId, 'ریت فعلی را وارد کن (مثلا 55):');
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

    return;
  }

  // شروع فرآیند محاسبه
  if (text === 'محاسبه ریت' || text === 'محاسبه برد/باخت') {
    if (user.points <= 0) return bot.sendMessage(userId, 'شما امتیازی برای استفاده ندارید.');
    updatePoints(userId, -1);
    userState[userId] = { type: text === 'محاسبه ریت' ? 'rate' : 'w/l', step: 'total' };
    return bot.sendMessage(userId, 'تعداد کل بازی‌ها را وارد کن:');
  }

  // لینک دعوت اختصاصی
  if (text === 'دریافت لینک دعوت') {
    return bot.sendMessage(userId, `لینک دعوت اختصاصی شما:\nhttps://t.me/my_rate_bot?start=${userId}`);
  }

  // نمایش حساب کاربری
  if (text === 'حساب کاربری') {
    return bot.sendMessage(userId,
      `آیدی عددی: ${userId}\nامتیاز باقی‌مانده: ${user.points}\nتعداد دعوتی‌ها: ${user.invites}`);
  }

  // پنل مدیریت
  if (userId === adminId) {
    if (text === '/panel') {
      return bot.sendMessage(adminId, 'انتخاب کن:', {
        reply_markup: {
          keyboard: [
            ['افزودن امتیاز', 'کسر امتیاز'],
            ['بازگشت']
          ],
          resize_keyboard: true
        }
      });
    }

    if (text === 'افزودن امتیاز' || text === 'کسر امتیاز') {
      userState[userId] = { step: 'enter_id', type: text.includes('افزودن') ? 'add' : 'sub' };
      return bot.sendMessage(userId, 'آیدی عددی کاربر را وارد کنید:');
    }

    const state = userState[userId];
    if (state && state.step === 'enter_id') {
      const targetId = parseInt(text);
      if (isNaN(targetId)) return bot.sendMessage(userId, 'آیدی عددی معتبر وارد کنید.');
      state.targetId = targetId;
      state.step = 'enter_amount';
      return bot.sendMessage(userId, 'مقدار امتیاز را وارد کنید:');
    }

    if (state && state.step === 'enter_amount') {
      const amount = parseInt(text);
      if (isNaN(amount)) return bot.sendMessage(userId, 'عدد وارد کن.');
      updatePoints(state.targetId, state.type === 'add' ? amount : -amount);
      bot.sendMessage(userId, 'انجام شد.');
      delete userState[userId];
      return;
    }
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
