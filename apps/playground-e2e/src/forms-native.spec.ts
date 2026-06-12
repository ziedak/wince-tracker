import { expect, test } from '@playwright/test';
import {
  expectQueueToContain,
  expectNoDeadClick,
  expectRuntimeToContain,
  openPlayground,
} from './playground.helpers';

test('submits the lead form and preserves the submitted payload', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByLabel('Email').fill('buyer@example.com');
  await page.getByLabel('Company').fill('Northwind');
  await page.getByLabel('Phone').fill('+1 555 0100');
  await page.locator('form#lead-form textarea[name="notes"]').fill('Ready to buy');
  await page.getByRole('button', { name: 'Submit form' }).click();

  await expectQueueToContain(page, '$form_submit', 'buyer@example.com', 'Northwind', 'Ready to buy');
  await expect(page.locator('[data-role="diag-events-queued"]')).not.toHaveText('—');

  await page.getByRole('button', { name: 'Reset form' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Company')).toHaveValue('');
  await expect(page.getByLabel('Phone')).toHaveValue('');
  await expect(page.locator('form#lead-form textarea[name="notes"]')).toHaveValue('');

  await expectNoDeadClick(page);
});

test('records native focus, input, change, pointer, and scroll activity', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByLabel('Search input').type('alpha');
  await page.getByLabel('Segment').selectOption({ label: 'High intent' });
  await page.getByLabel('Accept tracking updates').check();
  await page.getByRole('button', { name: 'Pointer me', exact: true }).click();
  await page.locator('[data-role="native-scroller"]').evaluate((node) => {
    const element = node as HTMLElement;
    element.scrollTop = 180;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  await expectRuntimeToContain(
    page,
    'native:focusin',
    'native:input',
    'native:change',
    'native:pointerdown',
    'native:scroll',
  );

  await expectNoDeadClick(page);
});

test('updates consent diagnostics when toggled', async ({ page }) => {
  await openPlayground(page);

  await page.getByRole('button', { name: 'Consent opt-in' }).click();
  await expect(page.locator('[data-role="consent-state"]')).toHaveText('Granted');

  await page.getByRole('button', { name: 'Consent opt-out' }).click();
  await expect(page.locator('[data-role="consent-state"]')).toHaveText('Denied');

  await expectNoDeadClick(page);
});
