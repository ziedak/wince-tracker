import { expect, test } from '@playwright/test';
import { openPlayground } from './playground.helpers';

test('loads the playground shell and renders diagnostics', async ({ page }) => {
  await openPlayground(page);

  await expect(page.locator('[data-role="tracker-state"]')).toHaveText('Ready');
  await expect(page.locator('[data-role="diag-window-id"]')).not.toHaveText('—');
  await expect(page.locator('[data-role="diag-session-id"]')).toHaveText('—');
  await expect(page.locator('[data-role="diag-dnt"]')).toHaveText(/^(Not set|⚠️ Active)/);
  await expect(page.locator('[data-role="diag-circuit-open"]')).toHaveText(/^(Open|Closed|—)$/);
});
