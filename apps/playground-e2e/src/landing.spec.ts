import { expect, test } from '@playwright/test';
import { expectQueueToContain, openPlayground, queueLog } from './playground.helpers';

test('loads the playground shell and renders diagnostics', async ({ page }) => {
  await openPlayground(page);

  await expect(page.locator('[data-role="tracker-state"]')).toHaveText('Ready');
  await expect(page.locator('[data-role="diag-window-id"]')).not.toHaveText('—');
  await expect(page.locator('[data-role="diag-session-id"]')).toHaveText('—');
  await expect(page.locator('[data-role="diag-dnt"]')).toHaveText(/^(Not set|⚠️ Active)/);
  await expect(page.locator('[data-role="diag-circuit-open"]')).toHaveText(/^(Open|Closed|—)$/);
});

test('page_view captures UTM params, device type, and referrer classification', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await openPlayground(page, {
    path: '/?utm_source=newsletter&utm_medium=email&utm_campaign=summer&utm_content=hero&utm_term=cart-recovery',
    referer: 'https://www.google.com/search?q=wince',
  });

  await expectQueueToContain(page, '$page_view');
  await expect(queueLog(page)).toContainText('utm_source');
  await expect(queueLog(page)).toContainText('newsletter');
  await expect(queueLog(page)).toContainText('utm_medium');
  await expect(queueLog(page)).toContainText('email');
  await expect(queueLog(page)).toContainText('device_type');
  await expect(queueLog(page)).toContainText('desktop');
  await expect(queueLog(page)).toContainText('referrer_type');
  await expect(queueLog(page)).toContainText('email');
});

test('page_leave emits session_duration on pagehide', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  await expectQueueToContain(page, '$page_leave');
  await expect(queueLog(page)).toContainText('session_duration_ms');
});
