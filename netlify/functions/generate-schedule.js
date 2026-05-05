import OpenAI from "openai";
import {
  buildPlannerContext,
  fallbackSchedule,
  repairSchedule,
  validatePlannerInput
} from "../../server/scheduler.js";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const validation = validatePlannerInput(body);
  if (!validation.ok) {
    return json(400, { error: "Invalid planner input", details: validation.errors });
  }

  const context = buildPlannerContext(body);
  if (!context.studyItems.length) {
    return json(200, { schedule: [], warnings: ["No upcoming assignments or exams need study time."] });
  }

  if (!context.availability.some((slot) => slot.endMin - slot.startMin >= context.preferences.minimumSessionMinutes)) {
    return json(200, { schedule: [], warnings: ["No free study slots match the minimum session length."] });
  }

  try {
    if (!client) throw new Error("OPENAI_API_KEY is not configured.");
    const aiSchedule = await generateWithOpenAI(context);
    const repaired = repairSchedule(aiSchedule, context);
    return json(200, { schedule: repaired.schedule, warnings: repaired.warnings, source: "openai" });
  } catch (error) {
    const fallback = fallbackSchedule(context);
    return json(200, {
      schedule: fallback.schedule,
      warnings: [
        "OpenAI generation failed, so a deterministic local schedule was used.",
        error.message
      ],
      source: "fallback"
    });
  }
}

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

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  };
}
