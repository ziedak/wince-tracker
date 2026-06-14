import { expect, test } from '@playwright/test';
import { openPlayground, expectQueueToContain, queueLog } from './playground.helpers';

test.describe('new signals', () => {
  test.beforeEach(async ({ page }) => {
    await openPlayground(page);
    // Consent is required before any tracker event fires.
    await page.getByRole('button', { name: 'Consent opt-in' }).click();
  });

  // --------------------------------------------------------------------------
  // Funnel events via cart plugin
  // --------------------------------------------------------------------------

  test('$cart_product_view fires on "View product" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'View product' }).click();
    await expectQueueToContain(page, '$cart_product_view');
  });

  test('$cart_view_cart fires on "View cart" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'View cart' }).click();
    await expectQueueToContain(page, '$cart_view_cart');
  });

  test('$cart_checkout_step fires on "Checkout step" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Checkout step' }).click();
    await expectQueueToContain(page, '$cart_checkout_step');
    await expect(page.locator('[data-role="queue-log"]')).toContainText('step');
    await expect(page.locator('[data-role="queue-log"]')).toContainText('1');
  });

  test('$cart_checkout_abandon fires on "Abandon checkout" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Abandon checkout' }).click();
    await expectQueueToContain(page, '$cart_checkout_abandon');
    await expect(queueLog(page)).toContainText('cart_id');
    await expect(queueLog(page)).toContainText('CART-PLAYGROUND-01');
  });

  test('$cart_purchase fires on "Purchase" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Purchase', exact: true }).click();
    await expectQueueToContain(page, '$cart_purchase');
    await expect(page.locator('[data-role="queue-log"]')).toContainText('revenue');
    await expect(page.locator('[data-role="queue-log"]')).toContainText('49.99');
  });

  test('$cart_option_selected fires on "Select option" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Select option', exact: true }).click();
    await expectQueueToContain(page, '$cart_option_selected');
    await expect(queueLog(page)).toContainText('option_name');
    await expect(queueLog(page)).toContainText('size');
    await expect(queueLog(page)).toContainText('option_value');
    await expect(queueLog(page)).toContainText('xl');
  });

  test('$cart_coupon_applied fires on "Apply coupon" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Apply coupon', exact: true }).click();
    await expectQueueToContain(page, '$cart_coupon_applied');
    await expect(queueLog(page)).toContainText('code_attempted');
    await expect(queueLog(page)).toContainText('SAVE10');
  });

  test('$cart_coupon_failed fires on "Fail coupon" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Fail coupon', exact: true }).click();
    await expectQueueToContain(page, '$cart_coupon_failed');
    await expect(queueLog(page)).toContainText('code_attempted');
    await expect(queueLog(page)).toContainText('BROKEN10');
    await expect(queueLog(page)).toContainText('failure_reason');
    await expect(queueLog(page)).toContainText('expired');
  });

  // --------------------------------------------------------------------------
  // Intervention feedback loop
  // --------------------------------------------------------------------------

  test('$intervention_shown fires on "Shown" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Shown', exact: true }).click();
    await expectQueueToContain(page, '$intervention_shown');
  });

  test('$intervention_clicked fires on "Clicked" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Clicked', exact: true }).click();
    await expectQueueToContain(page, '$intervention_clicked');
  });

  test('$intervention_accepted fires on "Accepted" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Accepted', exact: true }).click();
    await expectQueueToContain(page, '$intervention_accepted');
  });

  test('$intervention_dismissed fires on "Dismissed" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Dismissed', exact: true }).click();
    await expectQueueToContain(page, '$intervention_dismissed');
  });

  test('$intervention_ignored fires on "Ignored" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Ignored', exact: true }).click();
    await expectQueueToContain(page, '$intervention_ignored');
  });

  // --------------------------------------------------------------------------
  // Tab focus / blur
  // --------------------------------------------------------------------------

  test('$tab_focus_rollup fires after a blur/focus cycle and pagehide flush', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await expectQueueToContain(page, '$tab_focus_rollup');
  });

  // --------------------------------------------------------------------------
  // Performance signal
  // --------------------------------------------------------------------------

  test('$performance fires on pagehide', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await expectQueueToContain(page, '$performance');
    await expect(queueLog(page)).toContainText('ttfb_ms');
  });

  // --------------------------------------------------------------------------
  // Backtrack
  // --------------------------------------------------------------------------

  test('$backtrack fires on programmatic popstate', async ({ page }) => {
    await page.evaluate(() => {
      history.pushState(null, '', '/products');
      history.pushState(null, '', '/cart');
      // Manually emit popstate — jsdom auto-fires it on history.back() but
      // Playwright's chromium needs the manual dispatch after pushState+back.
      history.back();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expectQueueToContain(page, '$backtrack');
  });

  // --------------------------------------------------------------------------
  // Validation error
  // --------------------------------------------------------------------------

  test('$validation_error fires on required-field form submit', async ({ page }) => {
    // Submit the friction form without filling required fields.
    await page.locator('#friction-form').evaluate((form: HTMLFormElement) => {
      // Force native validation to fire without page reload.
      if (!form.checkValidity()) {
        form.reportValidity();
      }
    });
    await expectQueueToContain(page, '$validation_error');
  });

  // --------------------------------------------------------------------------
  // Double submit
  // --------------------------------------------------------------------------

  test('$double_submit fires on rapid re-submission of the same form', async ({ page }) => {
    await page.locator('#friction-form').evaluate((form: HTMLFormElement) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expectQueueToContain(page, '$double_submit');
  });
});
