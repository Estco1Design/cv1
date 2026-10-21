import fs from "node:fs";
import path from "node:path";
import { settings } from "../settings";
import { source, request, Profile } from "../providers";
import {
  InstagramSource,
  followersSchema,
  postSchema,
  SourceBlocked,
} from "./schema";
import { BrowserInstagramSource, sessionDir } from "./browser-source";
const browser = new BrowserInstagramSource();
export const httpSource: InstagramSource = {
  name: "http",
  async getFollowers(handle, cursor, limit) {
    const s = settings();
    if (!s.profileUrl)
      throw new SourceBlocked(
        "HTTP-источник не подключён. Укажите Profile provider URL в CRM → Settings либо выберите Browser и выполните instagram:login.",
      );
    try {
      return followersSchema.parse(
        await request(
          s.profileUrl.replace(/\/$/, "") + "/followers",
          { handle, cursor, limit },
          s.profileKey,
        ),
      );
    } catch (e) {
      throw new SourceBlocked(
        `Подписчики недоступны через provider: ${(e as Error).message}. Требуется endpoint /followers с правом читать подписчиков указанного аккаунта.`,
      );
    }
  },
  async fetchProfile(handle) {
    return source.fetch("https://www.instagram.com/" + handle + "/");
  },
  async fetchRecentPosts(handle, profile) {
    return profile.posts.map((p) => postSchema.parse(p));
  },
};
export function instagramSource(kind: string): InstagramSource {
  if (kind === "browser") return browser;
  if (kind === "http") return httpSource;
  throw new SourceBlocked("Неизвестный источник данных");
}
export function sourceStatus() {
  return {
    httpConfigured: !!settings().profileUrl,
    browserSessionPresent: fs.existsSync(
      path.join(sessionDir(), ".authorized"),
    ),
    browserNote:
      "Наличие локальной сессии не доказывает текущий вход. Доступ проверяется при вызове инструмента.",
    workerHeartbeat: settings().workerHeartbeat,
    aiConfigured: !!settings().baseUrl,
    aiBaseUrl: settings().baseUrl,
  };
}
export async function closeSources() {
  await browser.close();
}
