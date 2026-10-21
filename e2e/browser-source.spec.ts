import { test, expect } from "@playwright/test";
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserInstagramSource } from "../lib/agent/browser-source";
test("browser connector reads visible DOM, paginates via durable seen cursor and retains actual post URL/date — FIXTURE ONLY", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hideki-browser-fixture-"));
  const previousDir = process.env.INSTAGRAM_SESSION_DIR,
    previousExecutable = process.env.INSTAGRAM_BROWSER_EXECUTABLE;
  process.env.INSTAGRAM_SESSION_DIR = dir;
  process.env.INSTAGRAM_BROWSER_EXECUTABLE =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    chromium.executablePath();
  fs.writeFileSync(path.join(dir, ".authorized"), "TEST FIXTURE ONLY");
  const source = new BrowserInstagramSource();
  try {
    const ctx = await source.connection();
    await ctx.route("https://www.instagram.com/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/p/"))
        return route.fulfill({
          contentType: "text/html",
          body: '<html><head><meta property="og:description" content="TEST ONLY caption: new collection"><meta property="og:image" content="https://example.com/image.jpg"></head><body><main><article>TEST ONLY new collection<time datetime="2026-10-01T12:00:00Z"></time></article></main></body></html>',
        });
      return route.fulfill({
        contentType: "text/html",
        body: `<main><header><h1>TEST ONLY brand</h1><div>Fashion label based in Moscow</div><a href="/source_account/followers/" onclick="event.preventDefault();document.querySelector('#followers').style.display='block'">Followers</a></header><a href="https://outside.example/p/WRONG/">Not an Instagram post</a><a href="/p/TEST_ONLY/">Post</a></main><div id="followers" role="dialog" style="display:none"><a href="https://outside.example/not_a_follower/">External link</a><a href="/fixture_one/">one</a><a href="/fixture_two/">two</a></div>`,
      });
    });
    const first = await source.getFollowers("source_account", null, 1);
    expect(first.handles).toEqual(["fixture_one"]);
    expect(first.hasMore).toBe(true);
    const second = await source.getFollowers(
      "source_account",
      first.nextCursor,
      1,
    );
    expect(second.handles).toEqual(["fixture_two"]);
    const profile = await source.fetchProfile("fixture_one");
    expect(profile.bio).toContain("Moscow");
    const posts = await source.fetchRecentPosts("fixture_one", profile);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://www.instagram.com/p/TEST_ONLY/");
    expect(posts[0].publishedAt).toBe("2026-10-01T12:00:00Z");
    expect(posts[0].caption).toContain("TEST ONLY");
  } finally {
    await source.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.INSTAGRAM_SESSION_DIR;
    else process.env.INSTAGRAM_SESSION_DIR = previousDir;
    if (previousExecutable === undefined)
      delete process.env.INSTAGRAM_BROWSER_EXECUTABLE;
    else process.env.INSTAGRAM_BROWSER_EXECUTABLE = previousExecutable;
  }
});
