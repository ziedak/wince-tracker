import { test } from '@playwright/test';
import {
  expectQueueToContain,
  expectNoDeadClick,
  expectTransportToContain,
  openPlayground,
} from './playground.helpers';

test('tracks cart actions from the live cart context', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByLabel('Product ID').fill('SKU-EDGE-99');
  await page.getByLabel('Variant ID').fill('variant-deluxe');
  await page.getByLabel('Cart ID').fill('CART-EDGE-77');
  await page.getByLabel('Currency').fill('EUR');
  await page.getByLabel('Quantity').fill('3');
  await page.getByLabel('Price').fill('12.34');

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expectQueueToContain(page, '$click', '$cart_add', 'SKU-EDGE-99', 'variant-deluxe', '12.34');
  await expectTransportToContain(page, '$cart_add', 'SKU-EDGE-99', 'variant-deluxe');

  await page.getByRole('button', { name: 'Remove' }).click();
  await expectQueueToContain(page, '$cart_remove', '"price": 0');
  await expectTransportToContain(page, '$cart_remove');

  await expectNoDeadClick(page);
});

test('serializes empty numeric cart fields as zero', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByLabel('Quantity').fill('');
  await page.getByLabel('Price').fill('');
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await expectQueueToContain(page, '$cart_add', '"quantity": 0', '"price": 0');
  await expectNoDeadClick(page);
});
