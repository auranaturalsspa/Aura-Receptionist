const axios = require("axios");
const { SYSTEM_PROMPT } = require("./systemPrompt");
const db = require("./db");
const { sendWhatsAppMessage } = require("./whatsapp");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_NUMBER = process.env.OWNER_WHATSAPP_NUMBER;
const MODEL = "claude-3-5-haiku-20241022";

// In-memory conversation history per client phone number.
// (Fine for a small spa; for heavier scale, move this to the same JSON db or
// a real database.)
const conversations = {}; // { phone: [ {role, content}, ... ] }

const TOOLS = [
  {
    name: "check_availability",
    description: "Check which appointment time slots are open on a given date.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description: "Create a confirmed booking for a client.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        service: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM 24-hour" },
        mode: { type: "string", enum: ["in-spa", "mobile"] },
        notes: { type: "string" },
      },
      required: ["name", "phone", "service", "date", "time", "mode"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Hand the conversation over to a real staff member. Use for complaints, refunds, disputes, or anything outside your knowledge.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        client_message: { type: "string" },
      },
      required: ["reason", "client_message"],
    },
  },
];

async function runTool(toolName, toolInput, clientPhone) {
  if (toolName === "check_availability") {
    const slots = db.checkAvailability(toolInput.date);
    return { available_slots: slots };
  }

  if (toolName === "book_appointment") {
    const result = db.bookAppointment({ ...toolInput, phone: toolInput.phone || clientPhone });
    return result;
  }

  if (toolName === "escalate_to_human") {
    db.setEscalated(clientPhone, toolInput.reason);
    // Alert the real spa owner/staff immediately
    await sendWhatsAppMessage(
      OWNER_NUMBER,
      `🚩 Escalation needed\nClient: ${clientPhone}\nReason: ${toolInput.reason}\nMessage: "${toolInput.client_message}"\n\nReply to the client directly on WhatsApp - the AI will stay quiet on this chat until you resolve it. Message the AI number "resume" if you want it to take back over.`
    );
    return { escalated: true };
  }

  return { error: "unknown_tool" };
}

async function getClaudeReply(clientPhone, userMessage) {
  if (!conversations[clientPhone]) conversations[clientPhone] = [];
  const history = conversations[clientPhone];

  // Special: staff can text "resume" from the owner number to un-escalate a chat.
  // (Simple convenience command handled outside Claude.)
  history.push({ role: "user", content: userMessage });

  let messages = [...history];
  let finalText = "";

  // Loop to allow multiple tool calls in one turn
  for (let i = 0; i < 5; i++) {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: MODEL,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const content = response.data.content;
    const toolUses = content.filter((c) => c.type === "tool_use");
    const textBlocks = content.filter((c) => c.type === "text");

    finalText = textBlocks.map((t) => t.text).join("\n");

    if (toolUses.length === 0) {
      // No tools called - this is the final reply
      messages.push({ role: "assistant", content });
      break;
    }

    // Run each requested tool, then feed results back to Claude
    messages.push({ role: "assistant", content });
    const toolResults = [];
    for (const toolUse of toolUses) {
      const result = await runTool(toolUse.name, toolUse.input, clientPhone);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  conversations[clientPhone] = messages;
  return finalText || "Sorry, could you say that again?";
}

module.exports = { getClaudeReply };
