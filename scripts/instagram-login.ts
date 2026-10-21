import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { sessionDir, browserOptions } from "../lib/agent/browser-source";
async function main() {
  if (process.env.CI)
    throw new Error("Interactive login must run on your local Mac, outside CI");
  fs.mkdirSync(sessionDir(), { recursive: true, mode: 0o700 });
  fs.chmodSync(sessionDir(), 0o700);
  const ctx = await chromium.launchPersistentContext(
    sessionDir(),
    browserOptions(false),
  );
  try {
    const p = await ctx.newPage();
    await p.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
    });
    console.log(
      "Войдите в открывшемся окне самостоятельно. Не вводите пароль или коды в терминал. Не обходите CAPTCHA/2FA.",
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await rl.question(
      "После успешного входа и появления вашего профиля нажмите Enter здесь. ",
    );
    rl.close();
    if (
      /accounts\/login|challenge|checkpoint/.test(p.url()) ||
      (await p.locator('input[name="password"]').count())
    )
      throw new Error("Вход не завершён. Сессия не отмечена как подключённая.");
    const cookies = await ctx.cookies("https://www.instagram.com");
    if (!cookies.some((c) => c.name === "sessionid" && c.value))
      throw new Error("Авторизованная Instagram-сессия не обнаружена.");
    fs.writeFileSync(
      path.join(sessionDir(), ".authorized"),
      "operator-login\n",
      { mode: 0o600 },
    );
    console.log(
      "Локальная сессия сохранена. Закройте этот процесс перед запуском worker.",
    );
  } finally {
    await ctx.close();
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
