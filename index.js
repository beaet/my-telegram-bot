require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const token = process.env.BOT_TOKEN;
const adminId = Number(process.env.ADMIN_ID);
const webhookUrl = process.env.WEBHOOK_URL;
const port = process.env.PORT || 10000;

const bot = new TelegramBot(token, { polling: false });
bot.setWebHook(`${webhookUrl}/bot${token}`);

app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// اتصال به MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// مدل User
const userSchema = new mongoose.Schema({
  user_id: { type: Number, unique: true },
  username: { type: String, default: '' },
  points: { type: Number, default: 5 },
  invites: { type: Number, default: 0 },
  banned: { type: Boolean, default: false },
  last_chance_use: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// مدل Setting
const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});
const Setting = mongoose.model('Setting', settingSchema);

// اطمینان از وجود help_text در دیتابیس
(async () => {
  const help = await Setting.findOne({ key: 'help_text' });
  if (!help) {
    await new Setting({ key: 'help_text', value: 'برای استفاده از ربات از دکمه‌های منو استفاده کنید.' }).save();
  }
})();

// تابع گرفتن متن help
async function getHelpText() {
  const help = await Setting.findOne({ key: 'help_text' });
  return help ? help.value : 'متن راهنما موجود نیست.';
}

// ثبت یا بروزرسانی کاربر در دیتابیس
async function registerUser(user) {
  let dbUser = await User.findOne({ user_id: user.id });
  if (!dbUser) {
    dbUser = new User({
      user_id: user.id,
      username: user.username || '',
      points: 5,
      invites: 0,
      banned: false,
      last_chance_use: 0
    });
    await dbUser.save();
  }
  return dbUser;
}

// بررسی بن بودن کاربر
async function isBanned(user_id) {
  const user = await User.findOne({ user_id });
  return user ? user.banned : false;
}

// به‌روزرسانی امتیاز کاربر
async function addPoints(user_id, amount) {
  await User.updateOne({ user_id }, { $inc: { points: amount } });
}

// گرفتن اطلاعات کاربر
async function getUserInfo(user_id) {
  return await User.findOne({ user_id });
}

// دستورات ربات

bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const referrerId = match[1] ? Number(match[1]) : null;

  if (await isBanned(user.id)) {
    bot.sendMessage(chatId, 'شما توسط مدیر مسدود شده‌اید.');
    return;
  }

  const dbUser = await registerUser(user);

  // اگر رفرال وجود داشت و خودش نبود
  if (referrerId && referrerId !== user.id) {
    const referrer = await User.findOne({ user_id: referrerId });
    if (referrer) {
      // افزایش امتیاز به معرف
      await addPoints(referrerId, 5);
      // افزایش تعداد دعوت‌ها
      await User.updateOne({ user_id: referrerId }, { $inc: { invites: 1 } });
    }
  }

  // پیام خوش آمد
  const helpText = await getHelpText();

  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: 'محاسبه نرخ' }],
        [{ text: 'آمار برد و باخت' }],
        [{ text: 'اطلاعات من' }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };

  bot.sendMessage(chatId, `سلام ${user.first_name}!\n\n${helpText}`, keyboard);
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpText = await getHelpText();
  bot.sendMessage(chatId, helpText);
});

bot.onText(/\/ban (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (msg.from.id !== adminId) return;
  const userIdToBan = Number(match[1]);
  await User.updateOne({ user_id: userIdToBan }, { banned: true });
  bot.sendMessage(chatId, `کاربر ${userIdToBan} مسدود شد.`);
});

bot.onText(/\/unban (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (msg.from.id !== adminId) return;
  const userIdToUnban = Number(match[1]);
  await User.updateOne({ user_id: userIdToUnban }, { banned: false });
  bot.sendMessage(chatId, `کاربر ${userIdToUnban} از مسدودیت خارج شد.`);
});

bot.onText(/\/sethelp (.+)/, async (msg, match) => {
  if (msg.from.id !== adminId) return;
  const newHelp = match[1];
  await Setting.updateOne(
    { key: 'help_text' },
    { value: newHelp },
    { upsert: true }
  );
  bot.sendMessage(msg.chat.id, 'متن راهنما به روز شد.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (await isBanned(msg.from.id)) {
    bot.sendMessage(chatId, 'شما توسط مدیر مسدود شده‌اید.');
    return;
  }

  // پاسخ به دکمه‌ها
  if (text === 'محاسبه نرخ') {
    bot.sendMessage(chatId, 'لطفا عدد مورد نظر را وارد کنید:');
    bot.once('message', async (msg2) => {
      const input = msg2.text;
      // اینجا کد محاسبه نرخت را قرار بده
      bot.sendMessage(chatId, `نتیجه محاسبه نرخ: ${input} (شبیه سازی شده)`);
    });
  } else if (text === 'آمار برد و باخت') {
    // اینجا کد آمار را قرار بده
    bot.sendMessage(chatId, 'آمار برد و باخت در حال توسعه است.');
  } else if (text === 'اطلاعات من') {
    const userInfo = await getUserInfo(msg.from.id);
    if (!userInfo) {
      bot.sendMessage(chatId, 'شما در دیتابیس ثبت نشده‌اید.');
      return;
    }
    let infoText = `اطلاعات شما:\nشناسه: ${userInfo.user_id}\nنام کاربری: ${userInfo.username || 'ندارد'}\nامتیاز: ${userInfo.points}\nدعوت‌ها: ${userInfo.invites}\nمسدود شده: ${userInfo.banned ? 'بله' : 'خیر'}`;
    bot.sendMessage(chatId, infoText);
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
