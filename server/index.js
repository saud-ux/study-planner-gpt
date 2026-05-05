import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlannerContext,
  fallbackSchedule,
  repairSchedule,
  validatePlannerInput
} from "./scheduler.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, openaiConfigured: Boolean(client) });
});

app.post("/api/generate-schedule", async (req, res) => {
  const validation = validatePlannerInput(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: "Invalid planner input", details: validation.errors });
  }

  const context = buildPlannerContext(req.body);
  if (!context.studyItems.length) {
    return res.json({ schedule: [], warnings: ["No upcoming assignments or exams need study time."] });
  }

  if (!context.availability.some((slot) => slot.endMin - slot.startMin >= context.preferences.minimumSessionMinutes)) {
    return res.json({ schedule: [], warnings: ["No free study slots match the minimum session length."] });
  }

  try {
    if (!client) throw new Error("OPENAI_API_KEY is not configured.");

    const aiSchedule = await generateWithOpenAI(context);
    const repaired = repairSchedule(aiSchedule, context);
    res.json({ schedule: repaired.schedule, warnings: repaired.warnings, source: "openai" });
  } catch (error) {
    const fallback = fallbackSchedule(context);
    res.json({
      schedule: fallback.schedule,
      warnings: [
        "OpenAI generation failed, so a deterministic local schedule was used.",
        error.message
      ],
      source: "fallback"
    });
  }
});

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

async function generateWithOpenAI(context) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["schedule"],
    properties: {
      schedule: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["subject", "startTime", "endTime", "type"],
          properties: {
            subject: { type: "string" },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
            type: { type: "string", enum: ["study", "break"] }
          }
        }
      }
    }
  };

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    instructions: [
      "You are an academic scheduling optimizer.",
      "Return only JSON that follows the schema.",
      "Prioritize exams at 2x assignment importance, earlier due dates, harder subjects, and lower current grades.",
      "Use only provided availability windows. Do not schedule inside classes, commitments, sleep, or holidays.",
      "Prefer 60 minute sessions, never below 30 minutes, and keep long sessions between 120 and 180 minutes.",
      "Balance load across days and include break items only if requested."
    ].join(" "),
    input: JSON.stringify(context),
    text: {
      format: {
        type: "json_schema",
        name: "study_schedule",
        strict: true,
        schema
      }
    }
  });

  const text = response.output_text || response.output?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no parsable text.");
  return JSON.parse(text).schedule || [];
}

app.listen(port, () => {
  console.log(`Study planner API listening on http://127.0.0.1:${port}`);
});
