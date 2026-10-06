import { expect, test } from "@playwright/test";
import { certifyUiState, gotoStable } from "./support/app";
import { fulfillReplayContext, prepare } from "./support/replay-context";

const scriptFavoritesTest = test.extend({ video: "off" });

scriptFavoritesTest.describe("indicator script favorites interactions", () => {
  scriptFavoritesTest.beforeEach(async ({ page }) => prepare(page));

  scriptFavoritesTest("script favorites share the limit and activate the correct chart study", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("edgelab.indicator-favorites.v1.user-7001", JSON.stringify([
        "ema", "rsi", "vwap", "script:deleted-study",
      ]));
      window.localStorage.setItem("edgelab.custom-indicator-scripts.v1.user-7001", JSON.stringify([{
        category: "basic",
        color: "#22d3ee",
        createdAt: "2026-09-15T08:00:00.000Z",
        description: "A saved user study for favorites regression.",
        id: "user-favorites-ema",
        inputs: {},
        name: "My EMA",
        origin: "user",
        preview: "average",
        revision: 1,
        source: 'indicator "My EMA" overlay\nplot "My EMA" = ema(close, 5) color "#22d3ee"',
        synonyms: ["user", "favorites"],
        updatedAt: "2026-09-15T08:00:00.000Z",
        versions: [],
      }]));
    });
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Indicators", exact: true }).click();
    const library = page.getByRole("dialog", { name: "Indicator library" });
    const search = library.getByRole("searchbox", { name: "Search indicators by name, description, category, or synonym" });
    await search.fill("Average Directional Index");
    await library.getByRole("button", { name: "Add Average Directional Index to favorite indicators", exact: true }).click();
    await search.fill("My EMA");
    await library.getByRole("button", { name: "Add My EMA to favorite indicators", exact: true }).click();

    await search.fill("SMA");
    const limitButton = library.getByRole("button", { name: "Cannot add SMA to favorites; limit of 6 reached", exact: true });
    await expect(limitButton).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("edgelab.indicator-favorites.v1.user-7001") ?? "[]"),
    )).toEqual(["ema", "rsi", "vwap", "script:deleted-study", "script:first-party:adx", "script:user-favorites-ema"]);

    await search.fill("");
    await library.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(library.getByRole("listitem")).toHaveCount(6);
    await expect(library.getByRole("heading", { name: "Average Directional Index", exact: true })).toBeVisible();
    await expect(library.getByRole("heading", { name: "My EMA", exact: true })).toBeVisible();
    await expect(library.getByRole("heading", { name: "Unavailable script", exact: true })).toBeVisible();
    await library.getByRole("button", { name: "Remove unavailable script from favorite indicators", exact: true }).click();
    await expect(library.getByRole("listitem")).toHaveCount(5);
    await expect(library.getByRole("heading", { name: "Unavailable script", exact: true })).toHaveCount(0);
    await certifyUiState(page);
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await library.getByRole("list", { name: "Indicator results" }).evaluate((list) => {
      if (list.parentElement) list.parentElement.scrollTop = 0;
    });
    if (testInfo.project.name === "mobile") {
      const bounds = await library.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeLessThanOrEqual(16);
      expect(bounds!.height).toBeGreaterThanOrEqual(600);
      const firstCard = library.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "EMA", exact: true }) });
      for (const control of [
        firstCard.getByRole("heading", { name: "EMA", exact: true }),
        firstCard.getByRole("button", { name: "Remove EMA from favorite indicators", exact: true }),
        firstCard.getByRole("button", { name: "Add EMA indicator", exact: true }),
      ]) {
        await expect(control).toBeInViewport();
      }
    }
    if (["desktop", "mobile"].includes(testInfo.project.name)) {
      await page.screenshot({
        animations: "disabled",
        fullPage: false,
        path: `.impeccable/review/indicator-favorites-${testInfo.project.name}.png`,
      });
    }

    await library.getByRole("button", { name: "Close indicator library", exact: true }).click();
    const quickAdd = page.locator('[aria-label="Favorite indicators quick add"]');
    await quickAdd.getByRole("button", { name: "Add Average Directional Index indicator", exact: true }).click();
    await expect(quickAdd.getByRole("button", { name: "Add another Average Directional Index indicator; 1 active", exact: true })).toBeVisible();
    await quickAdd.getByRole("button", { name: "Add My EMA indicator", exact: true }).click();
    await expect(quickAdd.getByRole("button", { name: "Add another My EMA indicator; 1 active", exact: true })).toBeVisible();
    await quickAdd.getByRole("button", { name: "Add RSI indicator", exact: true }).click();
    await expect(quickAdd.getByRole("button", { name: "Add another RSI indicator; 1 active", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Indicators", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: "Indicator library" });
    await reopened.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(reopened.getByRole("button", { name: "Add Average Directional Index EdgeLab script; 1 active", exact: true })).toBeVisible();
    await expect(reopened.getByRole("button", { name: "Add My EMA EdgeLab script; 1 active", exact: true })).toBeVisible();
  });
});
