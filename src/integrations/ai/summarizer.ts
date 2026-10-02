import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError, ExternalServiceError } from "../../shared/http/errors.js";

export type CommentSummary = { issue: string[]; solution: string[]; nextSteps: string[] };
const EMPTY: CommentSummary = { issue: [], solution: [], nextSteps: [] };
const ResultSchema = z.object({
  issue: z.array(z.string()).max(5),
  solution: z.array(z.string()).max(5),
  nextSteps: z.array(z.string()).max(5),
});

const SYSTEM_PROMPT =
  "You analyse a back-and-forth comment thread on a software project ticket between a developer and a client. " +
  "Produce concise bullet points (max ~12 words each) under three keys: issue (problems raised), " +
  "solution (what was done or proposed to fix them), and nextSteps (outstanding actions). " +
  "Only include points grounded in the thread; use an empty array when a section has nothing. " +
  'Respond with ONLY a JSON object of the shape {"issue":[],"solution":[],"nextSteps":[]} and no other text.';

/** Lenient parse of the model's JSON (code fences, next_steps alias); falls back to empty lists. */
function parseSummary(text: string): CommentSummary {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return EMPTY;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const result = ResultSchema.safeParse({
      issue: parsed.issue ?? [],
      solution: parsed.solution ?? [],
      nextSteps: parsed.nextSteps ?? parsed.next_steps ?? [],
    });
    return result.success ? result.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function summarizeThread(
  ticket: string,
  comments: { author: string; body: string }[],
): Promise<CommentSummary> {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY)
    throw new AppError(503, "AI_NOT_CONFIGURED", "AI summaries are not configured.");
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  try {
    const { text } = await generateText({
      model: google(env.AI_SUMMARY_MODEL),
      system: SYSTEM_PROMPT,
      prompt: `Ticket: ${ticket}\n\nComment thread:\n${comments.map((c) => `${c.author}: ${c.body}`).join("\n")}`,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return parseSummary(text);
  } catch (error) {
    throw new ExternalServiceError("The AI service", { cause: error });
  }
}
