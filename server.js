require("dotenv").config();
const express = require("express");
const { getClaudeReply } = require("./src/claudeAgent");
const { sendWhatsAppMessage } = require("./src/whatsapp");
const db = require("./src/db");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const OWNER_NUMBER = process.env.OWNER_WHATSAPP_NUMBER;

// --- 1. Webhook verification (Meta calls this once when you set up the webhook) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Incoming messages from clients ---
app.post("/webhook", async (req, res) => {
  // Always respond 200 fast so Meta doesn't retry/timeout
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // e.g. a status update, not a new message

    const from = message.from; // client's phone number
    const text = message.text?.body?.trim();

    if (!text) return; // ignore non-text messages (images, audio, etc.) for now

    console.log(`Message from ${from}: ${text}`);

    // Owner sends "resume" to hand a chat back to the AI after resolving it
    if (from === OWNER_NUMBER && text.toLowerCase().startsWith("resume")) {
      const target = text.split(" ")[1]; // "resume 2567xxxx"
      if (target) {
        db.clearEscalated(target);
        await sendWhatsAppMessage(OWNER_NUMBER, `AI receptionist resumed for ${target}.`);
      }
      return;
    }

    // If this chat is currently escalated to a human, the AI stays silent
    if (db.isEscalated(from)) {
      console.log(`Chat with ${from} is escalated - AI staying quiet.`);
      return;
    }

    const reply = await getClaudeReply(from, text);
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

app.get("/", (req, res) => {
  res.send("Aura Naturals & Wellness Spa - AI receptionist is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Aura receptionist server listening on port ${PORT}`);
});
