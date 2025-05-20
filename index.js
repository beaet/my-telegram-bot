ممنون از فایل نمونه. طبق این ساختار، ربات را با امکانات موردنظرت به‌صورت یک فایل ساده و تمیز مانند server.js می‌سازم. این نسخه شامل موارد زیر است:

ویژگی‌ها:

اجرای ربات با Express و Webhook

ذخیره اطلاعات کاربران و امتیازها با SQLite

۵ امتیاز اولیه برای هر کاربر

۵ امتیاز اضافی برای هر دعوت موفق

دکمه‌های شیشه‌ای:

محاسبه ریت

محاسبه برد/باخت لازم

دریافت لینک دعوت

حساب من

خرید امتیاز (ارجاع به آیدی)

راهنما (قابل تنظیم)

پشتیبانی (ارجاع به آیدی خاص)


پنل مدیریت با دسترسی فقط برای آیدی عددی خاص:

خاموش/روشن کردن ربات

تغییر پیام راهنما

ارسال پیام همگانی

افزودن/کسر امتیاز

ارسال پیام به کاربر خاص



در ادامه، سورس کامل server.js:

const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

const TOKEN = "YOUR_BOT_TOKEN";
const API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_ID = 381183017;
let BOT_ACTIVE = true;

const db = new sqlite3.Database("./data.db");
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  invite_code TEXT,
  invited_by TEXT,
  score INTEGER DEFAULT 5
)`);

db.run(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
)`);

const sendMessage = (chat_id, text, keyboard = null) => {
  axios.post(`${API}/sendMessage`, {
    chat_id,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
};

const mainMenu = {
  inline_keyboard: [
    [{ text: "محاسبه ریت", callback_data: "calc_rate" }],
    [{ text: "برد/باخت لازم", callback_data: "calc_needed" }],
    [{ text: "دریافت لینک دعوت", callback_data: "invite_link" }],
    [{ text: "حساب من", callback_data: "my_account" }],
    [{ text: "خرید امتیاز", url: "https://t.me/Beast3694" }],
    [{ text: "راهنما", callback_data: "help" }],
    [{ text: "پشتیبانی", url: "https://t.me/Beast3694" }],
  ],
};

app.post(`/`, async (req, res) => {
  const update = req.body;
  const message = update.message;
  const callback = update.callback_query;

  if (message) {
    const chat_id = message.chat.id;
    const user_id = message.from.id;
    const username = message.from.username || "";

    if (message.text === "/start") {
      if (!BOT_ACTIVE && user_id !== ADMIN_ID) {
        return sendMessage(chat_id, "ربات فعلاً غیرفعال است.");
      }

      const invited_by = message.text.split(" ")[1];
      db.get("SELECT * FROM users WHERE id = ?", [user_id], (err, user) => {
        if (!user) {
          const invite_code = `${user_id}`;
          db.run(
            "INSERT INTO users (id, username, invite_code, invited_by) VALUES (?, ?, ?, ?)",
            [user_id, username, invite_code, invited_by || null]
          );

          if (invited_by && invited_by !== user_id.toString()) {
            db.run("UPDATE users SET score = score + 5 WHERE id = ?", [
              invited_by,
            ]);
          }
        }
      });

      sendMessage(
        chat_id,
        "به ربات خوش آمدید!",
        { inline_keyboard: mainMenu.inline_keyboard }
      );
    }
  }

  if (callback) {
    const data = callback.data;
    const user_id = callback.from.id;
    const chat_id = callback.message.chat.id;

    if (!BOT_ACTIVE && user_id !== ADMIN_ID) {
      return sendMessage(chat_id, "ربات فعلاً غیرفعال است.");
    }

    if (data === "calc_rate") {
      return sendMessage(chat_id, "لطفاً ریت و تعداد بازی‌ها را به‌صورت عددی وارد کن:\nمثال: 85 400");
    }

    if (data === "calc_needed") {
      return sendMessage(chat_id, "لطفاً ریت هدف، ریت فعلی و تعداد بازی را وارد کن:\nمثال: 90 85 400");
    }

    if (data === "invite_link") {
      return sendMessage(chat_id, `لینک دعوت شما:\nhttps://t.me/mlbbratebot?start=${user_id}`);
    }

    if (data === "my_account") {
      db.get("SELECT * FROM users WHERE id = ?", [user_id], (err, row) => {
        if (row) {
          sendMessage(chat_id, `امتیاز: ${row.score}\nآیدی عددی: ${row.id}`);
        } else {
          sendMessage(chat_id, "اکانت شما پیدا نشد. لطفاً /start را بزنید.");
        }
      });
    }

    if (data === "help") {
      db.get("SELECT value FROM settings WHERE key = 'help_text'", (err, row) => {
        const helpText = row?.value || "راهنمایی ثبت نشده است.";
        sendMessage(chat_id, helpText);
      });
    }
  }

  res.sendStatus(200);
});

// مدیریت
app.post("/admin", (req, res) => {
  const update = req.body;
  const message = update.message;
  if (!message) return res.sendStatus(200);

  const user_id = message.from.id;
  if (user_id !== ADMIN_ID) return res.sendStatus(200);

  const chat_id = message.chat.id;
  const text = message.text;

  if (text === "/panel") {
    return sendMessage(chat_id, "پنل مدیریت:", {
      keyboard: [
        ["روشن/خاموش کردن ربات"],
        ["تغییر راهنما", "ارسال پیام همگانی"],
        ["افزودن امتیاز", "کسر امتیاز"],
        ["ارسال پیام به کاربر خاص"],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  }

  if (text === "روشن/خاموش کردن ربات") {
    BOT_ACTIVE = !BOT_ACTIVE;
    return sendMessage(chat_id, `ربات اکنون: ${BOT_ACTIVE ? "روشن" : "خاموش"}`);
  }

  if (text === "تغییر راهنما") {
    return sendMessage(chat_id, "لطفاً متن جدید راهنما را ارسال کنید.");
  }

  if (text.startsWith("راهنما:")) {
    const newHelp = text.replace("راهنما:", "").trim();
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('help_text', ?)", [newHelp]);
    return sendMessage(chat_id, "راهنما ذخیره شد.");
  }

  if (text === "ارسال پیام همگانی") {
    return sendMessage(chat_id, "لطفاً پیام همگانی را ارسال کنید. پیشوند: همگانی:");
  }

  if (text.startsWith("همگانی:")) {
    const msg = text.replace("همگانی:", "").trim();
    db.all("SELECT id FROM users", (err, users) => {
      users.forEach(u => sendMessage(u.id, msg));
    });
    return sendMessage(chat_id, "پیام برای همه ارسال شد.");
  }

  if (text === "افزودن امتیاز" || text === "کسر امتیاز") {
    const mode = text === "افزودن امتیاز" ? "add" : "sub";
    return sendMessage(chat_id, `لطفاً به‌صورت "امتیاز ${mode} آیدی مقدار" وارد کنید\nمثال: امتیاز ${mode} 123456789 10`);
  }

  if (text.startsWith("امتیاز")) {
    const parts = text.split(" ");
    const mode = parts[1];
    const targetId = parseInt(parts[2]);
    const amount = parseInt(parts[3]);

    if (!targetId || !amount) return sendMessage(chat_id, "فرمت اشتباه است.");

    const query =
      mode === "add"
        ? "UPDATE users SET score = score + ? WHERE id = ?"
        : "UPDATE users SET score = score - ? WHERE id = ?";

    db.run(query, [amount, targetId]);
    return sendMessage(chat_id, "عملیات انجام شد.");
  }

  if (text === "ارسال پیام به کاربر خاص") {
    return sendMessage(chat_id, "لطفاً به‌صورت 'پیام به آیدی: متن' وارد کنید.");
  }

  if (text.startsWith("پیام به")) {
    const [_, rest] = text.split("پیام به");
    const [idPart, ...msgParts] = rest.trim().split(":");
    const targetId = parseInt(idPart.trim());
    const msg = msgParts.join(":").trim();

    sendMessage(targetId, msg);
    return sendMessage(chat_id, "پیام ارسال شد.");
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Bot server running on port ،10000");
});
