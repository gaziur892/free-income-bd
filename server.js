import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_URL = process.env.APP_URL || "";

const APP_NAME = "Free Income BD";
const REWARD_PER_AD = Number(process.env.REWARD_PER_AD || 1);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 100);

const DB_FILE = "./data.json";

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {
      users: {},
      withdrawals: []
    };
  }
}

function saveDB(db) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

function getUser(db, id, name = "") {
  const key = String(id);

  if (!db.users[key]) {
    db.users[key] = {
      id: key,
      name,
      balance: 0,
      totalEarned: 0,
      adsWatched: 0,
      referrals: 0,
      lastRewardAt: 0
    };
  }

  if (name) {
    db.users[key].name = name;
  }

  return db.users[key];
}

async function telegram(method, body) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data.result;
}

async function configureBotMenu() {
  if (!BOT_TOKEN || !APP_URL) return;

  try {
    await telegram("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "🚀 Open App",
        web_app: {
          url: APP_URL
        }
      }
    });

    console.log(
      "Telegram Mini App menu configured."
    );
  } catch (error) {
    console.error(
      "Menu setup error:",
      error.message
    );
  }
}

async function sendStart(chatId, firstName = "") {
  await telegram("sendMessage", {
    chat_id: chatId,

    text:
      `👋 Welcome${firstName ? " " + firstName : ""}!\n\n` +
      `Welcome to ${APP_NAME}.\n\n` +
      `Tap the button below to open the app.`,

    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Open Free Income BD",
            web_app: {
              url: APP_URL
            }
          }
        ]
      ]
    }
  });
}

// DEMO ONLY
// Real ad rewards must use official ad-network verification.
app.post("/api/demo/reward", (req, res) => {
  const { userId, name } = req.body || {};

  if (!userId) {
    return res.status(400).json({
      error: "userId required"
    });
  }

  const db = loadDB();
  const user = getUser(db, userId, name);

  const now = Date.now();

  if (now - user.lastRewardAt < 15000) {
    return res.status(429).json({
      error: "Please wait before another demo reward."
    });
  }

  user.balance += REWARD_PER_AD;
  user.totalEarned += REWARD_PER_AD;
  user.adsWatched += 1;
  user.lastRewardAt = now;

  saveDB(db);

  res.json({
    ok: true,
    user
  });
});

app.get("/api/user/:id", (req, res) => {
  const db = loadDB();

  const user = getUser(
    db,
    req.params.id
  );

  saveDB(db);

  res.json(user);
});

app.post("/api/withdraw", (req, res) => {
  const {
    userId,
    method,
    account
  } = req.body || {};

  if (!userId || !method || !account) {
    return res.status(400).json({
      error:
        "userId, method and account are required"
    });
  }

  const db = loadDB();

  const user = getUser(
    db,
    userId
  );

  if (user.balance < MIN_WITHDRAW) {
    return res.status(400).json({
      error:
        `Minimum withdrawal is ${MIN_WITHDRAW}`
    });
  }

  const withdrawal = {
    id: crypto.randomUUID(),
    userId: String(userId),
    method,
    account,
    amount: user.balance,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  db.withdrawals.push(withdrawal);

  user.balance = 0;

  saveDB(db);

  res.json({
    ok: true,
    withdrawal
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    appName: APP_NAME,
    rewardPerAd: REWARD_PER_AD,
    minWithdraw: MIN_WITHDRAW
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

let offset = 0;

async function startBotPolling() {
  console.log(
    "Telegram bot polling started."
  );

  while (true) {
    try {
      const updates =
        await telegram(
          "getUpdates",
          {
            offset,
            timeout: 25,
            allowed_updates: ["message"]
          }
        );

      for (const update of updates) {
        offset =
          update.update_id + 1;

        const message =
          update.message;

        if (!message?.chat?.id) {
          continue;
        }

        const text =
          message.text || "";

        if (
          text === "/start" ||
          text.startsWith("/start ")
        ) {
          await sendStart(
            message.chat.id,
            message.from?.first_name || ""
          );
        }

        else if (text === "/app") {
          await telegram(
            "sendMessage",
            {
              chat_id:
                message.chat.id,

              text:
                `🚀 Open ${APP_NAME}:`,

              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Open App",
                      web_app: {
                        url: APP_URL
                      }
                    }
                  ]
                ]
              }
            }
          );
        }

        else if (text === "/help") {
          await telegram(
            "sendMessage",
            {
              chat_id:
                message.chat.id,

              text:
                "Use /app to open the Mini App."
            }
          );
        }
      }
    }

    catch (error) {
      console.error(
        "Polling error:",
        error.message
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );
    }
  }
}

app.listen(
  PORT,
  async () => {
    console.log(
      `${APP_NAME} running on port ${PORT}`
    );

    await configureBotMenu();

    if (
      BOT_TOKEN &&
      APP_URL
    ) {
      startBotPolling();
    }
  }
);
