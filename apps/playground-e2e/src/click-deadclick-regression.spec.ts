import { expect, test } from '@playwright/test';
import {
  expectQueueToContain,
  expectNoDeadClick,
  queueLog,
  openPlayground,
} from './playground.helpers';

test('click and deadClick do not fire together on a working control', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByRole('button', { name: 'Track custom event' }).click();

  await expectQueueToContain(page, '$click', '$custom_probe');
  await expectNoDeadClick(page);
});

test('click payload includes hesitation_ms after a mouse move pause', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.mouse.move(40, 40);
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Track custom event' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  await expectQueueToContain(page, '$click', '$custom_probe');
  await expect(queueLog(page)).toContainText('hesitation_ms');
  await expectNoDeadClick(page);
});

test('manual page-view and error buttons emit only their intended signals', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByRole('button', { name: 'Track page view' }).click();
  await page.getByRole('button', { name: 'Raise error' }).click();

  await expectQueueToContain(page, '$page_view', '$error');
  await expectNoDeadClick(page);
});
