import { expect, type Locator, type Page } from '@playwright/test';

export interface OpenPlaygroundOptions {
  path?: string;
  referer?: string;
}

export async function openPlayground(page: Page, options?: OpenPlaygroundOptions): Promise<void> {
  await page.goto(options?.path ?? '/', options?.referer ? { referer: options.referer } : undefined);

  await expect(
    page.getByRole('heading', { name: 'Cart recovery event lab' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Storefront harness' }),
  ).toBeVisible();
}

export function queueLog(page: Page): Locator {
  return page.locator('[data-role="queue-log"]');
}

export function transportLog(page: Page): Locator {
  return page.locator('[data-role="transport-log"]');
}

export function runtimeLog(page: Page): Locator {
  return page.locator('[data-role="log"]');
}

export async function expectQueueToContain(page: Page, ...texts: string[]): Promise<void> {
  const log = queueLog(page);
  for (const text of texts) {
    await expect(log).toContainText(text);
  }
}

export async function expectQueueToNotContain(page: Page, text: string): Promise<void> {
  await expect(queueLog(page)).not.toContainText(text);
}

export async function expectTransportToContain(page: Page, ...texts: string[]): Promise<void> {
  const log = transportLog(page);
  for (const text of texts) {
    await expect(log).toContainText(text);
  }
}

export async function expectRuntimeToContain(page: Page, ...texts: string[]): Promise<void> {
  const log = runtimeLog(page);
  for (const text of texts) {
    await expect(log).toContainText(text);
  }
}

export async function expectNoDeadClick(page: Page, waitMs = 800): Promise<void> {
  await page.waitForTimeout(waitMs);
  await expect(queueLog(page)).not.toContainText('$dead_click');
}
