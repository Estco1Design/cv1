import { test, expect } from "@playwright/test";
test("agent chat is primary, natural task survives reload, stop/resume, mobile console and secondary CRM", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Поставьте задачу/ }),
  ).toBeVisible();
  const prompt =
    "Проанализируй подписчиков @alexandro_hideki, найди 1 клиента из Москвы для fashion-съёмок";
  await page.getByLabel("Задача агенту на естественном языке").fill(prompt);
  await page.getByRole("button", { name: "START →", exact: true }).click();
  await expect(page.getByText(prompt, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await expect(
    page.getByText("Задача остановлена.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(prompt, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "RESUME", exact: true }).click();
  await expect(
    page.getByText("Продолжаю с сохранённого контрольного шага.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Инструменты и прогресс", exact: true })
    .click();
  await expect(
    page.getByText("Ожидает worker.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "+ НОВАЯ ЗАДАЧА", exact: true })
    .click();
  await page.waitForTimeout(3000);
  await expect(
    page.getByRole("heading", { name: /Поставьте задачу/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "ОТКРЫТЬ CRM ↗", exact: true }).click();
  await expect(page.getByRole("heading", { name: /The next/ })).toBeVisible();
});
