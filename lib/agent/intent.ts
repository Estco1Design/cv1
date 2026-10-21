import { completion } from "../ai";
import { intentSchema, TaskIntent } from "./schema";
export function localIntent(text: string): TaskIntent | null {
  const handle = text.match(
    /@([a-zA-Z0-9._]{1,30})|instagram\.com\/([a-zA-Z0-9._]{1,30})/,
  );
  if (!handle || !/(подписчик|follower)/i.test(text)) return null;
  const city = /москв|moscow/i.test(text) ? "Москва" : null;
  if (!city) return null;
  const count = Number(
    text.match(/(?:найди|найти|отбери|find)\s+(\d+)/i)?.[1] || 30,
  );
  return intentSchema.parse({
    sourceHandle: (handle[1] || handle[2]).toLowerCase(),
    city,
    targetCount: count,
    maxProfiles: Math.min(2000, Math.max(100, count * 10)),
    excludedCategories: /(?:без|убери|исключи)\s+агентств/i.test(text)
      ? ["агентства"]
      : [],
    offerInstructions: /без вопросов/i.test(text)
      ? "Не используй вопросы и вопросительные знаки."
      : "",
    outreachMode: "approval",
    parsedBy: "local_rules",
  });
}
export async function parseIntent(text: string) {
  const explicit = text.match(
    /@([a-zA-Z0-9._]{1,30})|instagram\.com\/([a-zA-Z0-9._]{1,30})/,
  );
  if (!explicit)
    throw new Error(
      "Укажите исходный Instagram @username или URL. Агент не выдумывает аккаунт.",
    );
  try {
    const parsed = intentSchema.parse({
      ...(await completion(
        'Parse the operator task into JSON {sourceHandle (no @),city,targetCount(1..200),maxProfiles(1..2000),excludedCategories:[],offerInstructions,outreachMode:"approval"}. Do not invent a source handle or authorize automatic sending. This is the operator request, not profile data.',
        { operatorRequest: text },
      )),
      parsedBy: "llm",
      outreachMode: "approval",
    });
    if (
      parsed.sourceHandle.toLowerCase() !==
      (explicit[1] || explicit[2]).toLowerCase()
    )
      throw new Error("AI changed source");
    parsed.sourceHandle = parsed.sourceHandle.toLowerCase();
    parsed.maxProfiles = Math.max(parsed.targetCount, parsed.maxProfiles);
    return parsed;
  } catch (e) {
    const local = localIntent(text);
    if (local) return local;
    throw new Error(
      "Не удалось разобрать задачу. Укажите @аккаунт, город и число клиентов, например: «Изучи подписчиков @brand, найди 30 клиентов из Москвы». Настройте доступный AI для других формулировок.",
    );
  }
}
export type Followup =
  | { type: "why"; handle?: string }
  | { type: "more"; count: number }
  | { type: "exclude_agencies" }
  | { type: "rewrite"; instructions: string }
  | { type: "unknown" };
export function followup(text: string): Followup {
  if (/почему|обоснуй/i.test(text))
    return { type: "why", handle: text.match(/@([\w.]+)/)?.[1].toLowerCase() };
  if (/(?:ещ[ёе]|another)\s+(\d+)/i.test(text))
    return {
      type: "more",
      count: Math.min(
        200,
        Number(text.match(/(?:ещ[ёе]|another)\s+(\d+)/i)![1]),
      ),
    };
  if (/(?:убери|исключи|без)\s+агентств/i.test(text))
    return { type: "exclude_agencies" };
  if (/переделай|перепиши|перегенерируй/i.test(text))
    return {
      type: "rewrite",
      instructions: /без вопросов/i.test(text)
        ? "Не используй вопросы и вопросительные знаки."
        : text.slice(0, 1500),
    };
  return { type: "unknown" };
}
