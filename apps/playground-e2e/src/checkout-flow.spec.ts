import { test } from '@playwright/test';
import {
  expectNoDeadClick,
  expectQueueToContain,
  openPlayground,
} from './playground.helpers';

test('walks a realistic checkout flow and records friction signals', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('button', { name: 'Consent opt-in' }).click();

  await page.getByLabel('Product ID').fill('SKU-CHECKOUT-42');
  await page.getByLabel('Variant ID').fill('variant-checkout');
  await page.getByLabel('Cart ID').fill('CART-CHECKOUT-01');
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Quantity').fill('2');
  await page.getByLabel('Price').fill('99.50');

  await page.getByRole('button', { name: 'View product' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('button', { name: 'View cart' }).click();
  await page.getByRole('button', { name: 'Start checkout' }).click();
  await page.getByRole('button', { name: 'Checkout step', exact: true }).click();

  await expectQueueToContain(
    page,
    '$cart_product_view',
    '$cart_add',
    '$cart_view_cart',
    '$cart_checkout_start',
    '$cart_checkout_step',
    'SKU-CHECKOUT-42',
    'variant-checkout',
    'CART-CHECKOUT-01',
    '"currency": "USD"',
    '"quantity": 2',
    '"step": 1',
  );

  await page.locator('#friction-form').evaluate((form: HTMLFormElement) => {
    if (!form.checkValidity()) {
      form.reportValidity();
    }
  });
  await expectQueueToContain(
    page,
    '$validation_error',
    '"field_name": "friction-email"',
    '"form_id": "friction-form"',
    '"validation_message":',
  );

  await page.getByLabel('Email (required)').fill('buyer@example.com');
  await page.getByLabel('Phone (required)').fill('+1 555 0100');

  await page.locator('#friction-form').evaluate((form: HTMLFormElement) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expectQueueToContain(page, '$double_submit');

  await page.getByRole('button', { name: 'Purchase', exact: true }).click();
  await expectQueueToContain(
    page,
    '$cart_purchase',
    '"revenue": 99.5',
    'CART-CHECKOUT-01',
    '"currency": "USD"',
    '"quantity": 2',
  );

  await expectNoDeadClick(page);
});