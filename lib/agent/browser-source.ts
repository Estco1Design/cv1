import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { profileSchema, Profile } from "../providers";
import {
  SourceBlocked,
  InstagramSource,
  FollowerPage,
  RecentPost,
} from "./schema";
export function sessionDir() {
  return path.resolve(
    process.env.INSTAGRAM_SESSION_DIR || "./data/instagram-session",
  );
}
export function browserOptions(headless = true) {
  const raw =
    process.env.INSTAGRAM_BROWSER_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY;
  let proxy:
    | { server: string; username?: string; password?: string; bypass?: string }
    | undefined;
  if (raw) {
    const url = new URL(raw);
    proxy = {
      server: `${url.protocol}//${url.host}`,
      bypass: "127.0.0.1,localhost",
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  }
  return {
    headless,
    executablePath: process.env.INSTAGRAM_BROWSER_EXECUTABLE || undefined,
    viewport: { width: 1280, height: 900 },
    timeout: 20000,
    ...(proxy ? { proxy } : {}),
  };
}
const validHandle = (h: string) =>
  /^[a-zA-Z0-9._]{1,30}$/.test(h) &&
  ![
    "accounts",
    "explore",
    "direct",
    "p",
    "reel",
    "reels",
    "stories",
    "about",
    "legal",
  ].includes(h.toLowerCase());
/** Visible website only. No private endpoints, password capture, stealth, CAPTCHA or challenge bypass. */
export class BrowserInstagramSource implements InstagramSource {
  name = "browser";
  private context?: BrowserContext;
  async connection() {
    if (!fs.existsSync(path.join(sessionDir(), ".authorized")))
      throw new SourceBlocked(
        "Браузерная сессия не подключена. На Mac остановите worker, выполните npm run instagram:login, войдите вручную и снова запустите worker.",
      );
    if (!this.context) {
      try {
        this.context = await chromium.launchPersistentContext(
          sessionDir(),
          browserOptions(process.env.INSTAGRAM_BROWSER_HEADLESS !== "false"),
        );
      } catch {
        throw new SourceBlocked(
          "Не удалось открыть выделенную сессию Instagram. Закройте окно instagram:login и другой worker; установите Chromium через npx playwright install chromium или задайте INSTAGRAM_BROWSER_EXECUTABLE.",
        );
      }
    }
    return this.context;
  }
  async page(handle: string) {
    if (!validHandle(handle)) throw new Error("Некорректный handle");
    const ctx = await this.connection();
    const page = await ctx.newPage();
    try {
      await page.goto(`https://www.instagram.com/${handle}/`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(1500);
      await this.guard(page);
      return page;
    } catch (e) {
      await page.close();
      throw e;
    }
  }
  async guard(page: Page) {
    const u = page.url();
    if (/\/accounts\/login|\/challenge|\/checkpoint/.test(u))
      throw new SourceBlocked(
        "Instagram требует вход, 2FA или проверку. Остановите worker, откройте instagram:login и пройдите проверку вручную.",
      );
    if (await page.locator('input[name="password"]').count())
      throw new SourceBlocked(
        "Instagram показал форму входа; авторизованная сессия недоступна. Выполните instagram:login.",
      );
    const text = (await page.locator("body").innerText()).slice(0, 12000);
    if (
      /try again later|please wait a few minutes|попробуйте.*позже|слишком много запросов|automated behavior|подозрительн.*активност/i.test(
        text,
      )
    )
      throw new SourceBlocked(
        "Instagram ограничил доступ/частоту запросов. Задание приостановлено; не обходите ограничение, повторите позже вручную.",
      );
  }
  async getFollowers(
    handle: string,
    cursor: string | null,
    limit: number,
  ): Promise<FollowerPage> {
    const page = await this.page(handle);
    try {
      const c = cursor ? JSON.parse(cursor) : { seen: [] };
      const seen = new Set<string>(c.seen || []),
        found: string[] = [];
      const link = page
        .locator(
          `a[href$="/${handle}/followers/"],a[href$="/${handle}/followers"]`,
        )
        .first();
      if (!(await link.count()))
        throw new SourceBlocked(
          "Ссылка на подписчиков недоступна в текущем интерфейсе Instagram. Аккаунт может быть закрыт, доступ ограничен или разметка изменилась.",
        );
      await link.click({ timeout: 10000 });
      const dialog = page.locator('[role="dialog"]').last();
      try {
        await dialog.waitFor({ state: "visible", timeout: 12000 });
      } catch {
        await this.guard(page);
        throw new SourceBlocked(
          "Instagram не открыл список подписчиков. Проверьте доступ вручную в выделенной сессии.",
        );
      }
      let atEnd = false,
        stalls = 0;
      for (let scroll = 0; scroll < 40 && found.length < limit; scroll++) {
        await this.guard(page);
        const handles = await dialog.locator("a[href]").evaluateAll((links) =>
          links.map((a) => {
            const u = new URL((a as HTMLAnchorElement).href);
            if (!["www.instagram.com", "instagram.com"].includes(u.hostname))
              return "";
            const m = u.pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
            return m ? m[1].toLowerCase() : "";
          }),
        );
        for (const h of handles)
          if (validHandle(h) && h !== handle.toLowerCase() && !seen.has(h)) {
            seen.add(h);
            found.push(h);
            if (found.length >= limit) break;
          }
        if (found.length >= limit) break;
        const moved = await dialog.evaluate((el) => {
          const nodes = [el, ...Array.from(el.querySelectorAll("*"))];
          const scroller = nodes.find(
            (n) =>
              n.scrollHeight > n.clientHeight + 60 &&
              /(auto|scroll)/.test(getComputedStyle(n).overflowY),
          );
          if (!scroller) return false;
          const before = scroller.scrollTop;
          scroller.scrollTop += Math.max(300, scroller.clientHeight * 0.8);
          return scroller.scrollTop > before;
        });
        await page.waitForTimeout(1000);
        if (!moved) {
          stalls++;
          if (stalls >= 3) {
            atEnd = true;
            break;
          }
        } else stalls = 0;
      }
      if (!found.length && !atEnd)
        throw new SourceBlocked(
          "За ограниченный проход не обнаружены новые доступные подписчики. Сохранённый список не потерян; для больших списков используйте API с cursor pagination.",
        );
      return {
        handles: found,
        nextCursor: atEnd ? null : JSON.stringify({ seen: [...seen] }),
        hasMore: !atEnd,
        limitation:
          "Получены только строки, доступные в текущем браузерном списке. Порядок и полнота Instagram не гарантированы; DOM-сессия не является снимком всех подписчиков.",
      };
    } finally {
      await page.close();
    }
  }
  async fetchProfile(handle: string): Promise<Profile> {
    const page = await this.page(handle);
    try {
      const header = page.locator("main header").first();
      if (!(await header.count()))
        throw new Error(
          "Профиль не доступен для чтения в текущей сессии или изменилась разметка Instagram.",
        );
      const bio = await header.innerText();
      const name = await header.locator("h1,h2").allTextContents();
      return profileSchema.parse({
        username: handle,
        name: name.join(" ").slice(0, 200),
        bio: bio.slice(0, 8000),
        links: await header
          .locator('a[href^="http"]')
          .evaluateAll((els) =>
            els
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((h) => !h.includes("instagram.com")),
          ),
        posts: [],
        fetchedAt: new Date().toISOString(),
      });
    } finally {
      await page.close();
    }
  }
  async fetchRecentPosts(
    handle: string,
    _profile?: Profile,
  ): Promise<RecentPost[]> {
    const page = await this.page(handle);
    try {
      const privateText = await page
        .locator("main")
        .innerText()
        .catch(() => "");
      if (
        /this account is private|это закрытый аккаунт|аккаунт закрыт/i.test(
          privateText,
        )
      )
        return [];
      const links = await page
        .locator('main a[href*="/p/"],main a[href*="/reel/"]')
        .evaluateAll((els) =>
          [
            ...new Set(
              els
                .map((a) => new URL((a as HTMLAnchorElement).href))
                .filter(
                  (u) =>
                    ["www.instagram.com", "instagram.com"].includes(
                      u.hostname,
                    ) && /\/(p|reel)\/[a-zA-Z0-9_-]+/.test(u.pathname),
                )
                .map((u) => u.href),
            ),
          ].slice(0, 3),
        );
      const posts: RecentPost[] = [];
      for (const url of links) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(800);
        await this.guard(page);
        const caption = await page
          .locator('meta[property="og:description"]')
          .getAttribute("content")
          .catch(() => null);
        const text = await page
          .locator("main article")
          .innerText()
          .catch(() => "");
        const publishedAt = await page
          .locator("time[datetime]")
          .first()
          .getAttribute("datetime")
          .catch(() => null);
        const imageUrl = await page
          .locator('meta[property="og:image"]')
          .getAttribute("content")
          .catch(() => null);
        if (caption || text)
          posts.push({
            caption: (caption || text).slice(0, 12000),
            url,
            ...(publishedAt ? { publishedAt } : {}),
            ...(imageUrl ? { imageUrl } : {}),
          });
      }
      return posts;
    } finally {
      await page.close();
    }
  }
  async close() {
    await this.context?.close();
    this.context = undefined;
  }
}
