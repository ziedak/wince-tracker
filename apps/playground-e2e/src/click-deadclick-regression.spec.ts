import { test } from '@playwright/test';
import {
  expectQueueToContain,
  expectNoDeadClick,
  openPlayground,
} from './playground.helpers';

test('click and deadClick do not fire together on a working control', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByRole('button', { name: 'Track custom event' }).click();

  await expectQueueToContain(page, '$click', '$custom_probe');
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
