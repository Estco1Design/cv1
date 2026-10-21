import { test, expect } from "@playwright/test";
test("imports and persists real leads, honest source errors and mobile layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /The next/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Lead Discovery", exact: true })
    .click();
  await page
    .getByPlaceholder("https://www.instagram.com/brand/", { exact: true })
    .fill("@e2e_brand");
  await page.getByRole("button", { name: "ДОБАВИТЬ ↗", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Сохранено");
  await page
    .getByRole("button", { name: "Lead Database", exact: true })
    .click();
  await page.getByRole("button", { name: "@e2e_brand", exact: true }).click();
  await expect(page.getByRole("heading", { name: "@e2e_brand" })).toBeVisible();
  await expect(
    page.getByText("Данных источника пока нет.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Lead Database", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "@e2e_brand", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI connection" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("API key", { exact: false }).first(),
  ).toHaveAttribute("type", "password");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("demo is explicitly labelled and service status is real", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Lead Discovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ДОБАВИТЬ DEMO", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Сохранено");
  await page
    .getByRole("button", { name: "Lead Database", exact: true })
    .click();
  await expect(
    page.getByText("DEMO / Atelier Form", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Outreach", exact: true }).click();
  await expect(page.getByText("DRAFT MODE")).toBeVisible();
});
