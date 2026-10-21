import { z } from "zod";
import { settings } from "./settings";
export const profileSchema = z.object({
  username: z.string(),
  name: z.string().default(""),
  bio: z.string().default(""),
  category: z.string().default(""),
  country: z.string().default(""),
  city: z.string().default(""),
  links: z.array(z.string()).default([]),
  contacts: z.array(z.string()).default([]),
  followers: z.number().optional(),
  posts: z
    .array(
      z.object({
        caption: z.string().default(""),
        publishedAt: z.string().optional(),
        imageUrl: z.string().url().optional(),
      }),
    )
    .default([]),
  fetchedAt: z.string().optional(),
});
export type Profile = z.infer<typeof profileSchema>;
export interface ProfileSource {
  fetch(url: string): Promise<Profile>;
  discover?(filters: Record<string, string>): Promise<Profile[]>;
}
export const demoProfile: Profile = {
  username: "hideki_demo_atelier",
  name: "DEMO / Atelier Form",
  bio: "Вымышленный тестовый fashion-бренд. Новая коллекция графичных силуэтов. Ищем команду для кампании.",
  category: "Fashion brand",
  country: "DEMO",
  city: "DEMO",
  links: [],
  contacts: [],
  posts: [
    {
      caption: "DEMO: готовим новую коллекцию; ищем фотографа для кампании.",
      publishedAt: new Date().toISOString(),
    },
  ],
};
export async function request(url: string, body: unknown, token = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Провайдер вернул HTTP ${response.status}`);
  return response.json();
}
export const source: ProfileSource = {
  async fetch(url) {
    const s = settings();
    if (!s.profileUrl)
      throw new Error(
        "Источник не подключён. URL сохранён, данные Instagram не получены. Подключите разрешённый provider в Settings.",
      );
    const p = profileSchema.parse(
      await request(s.profileUrl, { url }, s.profileKey),
    );
    const expected = new URL(url).pathname.split("/")[1];
    if (p.username.toLowerCase() !== expected.toLowerCase())
      throw new Error("Источник вернул другой username");
    return p;
  },
  async discover(filters) {
    const s = settings();
    if (!s.profileUrl) throw new Error("Discovery provider не подключён");
    const data = await request(
      s.profileUrl.replace(/\/$/, "") + "/discover",
      { filters },
      s.profileKey,
    );
    return z.array(profileSchema).parse(data.profiles);
  },
};
export interface OutreachProvider {
  capabilities(
    recipient: string,
  ): Promise<{ allowed: boolean; reason?: string }>;
  send(
    recipient: string,
    text: string,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}
export const outreach: OutreachProvider = {
  async capabilities(recipient) {
    const s = settings();
    if (!s.outreachUrl)
      return {
        allowed: false,
        reason:
          "Автоматическая отправка не подключена. Используйте копирование и открытие профиля.",
      };
    const r = await request(
      s.outreachUrl.replace(/\/$/, "") + "/capabilities",
      { recipient, channel: "instagram" },
      s.outreachKey,
    );
    return z
      .object({ allowed: z.boolean(), reason: z.string().optional() })
      .parse(r);
  },
  async send(recipient, text, idempotencyKey) {
    const s = settings();
    return z
      .object({ id: z.string().min(1) })
      .parse(
        await request(
          s.outreachUrl.replace(/\/$/, "") + "/send",
          { recipient, text, idempotencyKey, channel: "instagram" },
          s.outreachKey,
        ),
      );
  },
};
