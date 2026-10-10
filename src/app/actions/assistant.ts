"use server";

import { requireUser } from "@/lib/auth";
import { getSnapshot } from "@/lib/data";
import { answer, type AssistantAnswer } from "@/lib/assistant/engine";
import { askClaude } from "@/lib/assistant/claude";

export async function ask(question: string, history: { role: "user" | "assistant"; content: string }[]): Promise<AssistantAnswer> {
  const user = await requireUser();
  const q = question.trim().slice(0, 600);
  const snapshot = await getSnapshot(user.id);
  if (!q) return answer("", snapshot);
  const ai = await askClaude(q, history.filter((h) => typeof h.content === "string").map((h) => ({ role: h.role, content: h.content.slice(0, 2000) })), snapshot);
  return ai ?? answer(q, snapshot);
}
