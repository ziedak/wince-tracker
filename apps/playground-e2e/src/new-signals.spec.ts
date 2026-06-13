import { test } from '@playwright/test';
import { openPlayground, expectQueueToContain } from './playground.helpers';

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
  });

  test('$cart_checkout_abandon fires on "Abandon checkout" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Abandon checkout' }).click();
    await expectQueueToContain(page, '$cart_checkout_abandon');
  });

  test('$cart_purchase fires on "Purchase" button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Purchase', exact: true }).click();
    await expectQueueToContain(page, '$cart_purchase');
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

  test('$tab_blur fires when page becomes hidden', async ({ page }) => {
    // Simulate the page becoming hidden by setting visibilityState via CDP.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectQueueToContain(page, '$tab_blur');
  });

  test('$tab_focus fires when page becomes visible again', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectQueueToContain(page, '$tab_focus');
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
    const submitBtn = page.locator('#friction-form button[type="submit"]');
    // Two rapid clicks — should trigger double_submit.
    await submitBtn.click();
    await submitBtn.click();
    await expectQueueToContain(page, '$double_submit');
  });
});
