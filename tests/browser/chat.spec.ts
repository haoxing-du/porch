import { test, expect } from '@playwright/test';
test('two people chat live, reload history, and navigate on a phone', async ({ browser, page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Alex' }).click();
  await page.locator('.workspace-nav').getByRole('button', { name: 'Create workspace' }).click();
  await page.getByLabel('Workspace name').fill(`Friends ${Date.now()}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Invite friends' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const second = await browser.newContext();
  const sam = await second.newPage();
  await sam.goto(link);
  await sam.getByRole('button', { name: 'Continue as Sam' }).click();
  await sam.getByRole('button', { name: 'Join workspace' }).click();
  await page.getByRole('button', { name: 'Welcome', exact: false }).first().click();
  await sam.getByRole('button', { name: 'Welcome', exact: false }).first().click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello from Alex');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(sam.getByText('Hello from Alex', { exact: true })).toBeVisible();
  await sam.getByRole('textbox', { name: 'Message' }).fill('/nb human secret');
  await sam.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('human secret', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Hello from Alex', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'New topic' })).toBeVisible();
  await page.getByRole('button', { name: 'Welcome', exact: false }).first().click();
  await page.getByRole('textbox', { name: 'Message' }).fill('From a phone');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(sam.getByText('From a phone', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/chat-mobile.png', fullPage: true });
  await sam.screenshot({ path: 'test-results/chat-desktop.png', fullPage: true });
  await second.close();
});
test('a dropped send response survives refresh without duplicating the message', async ({
  page,
}) => {
  await page.request.post('/api/auth/dev', { data: { name: 'alex' } });
  const response = await page.request.post('/api/workspaces', {
    data: { name: `Retry ${Date.now()}` },
  });
  const workspace = await response.json();
  const snapshot = await (
    await page.request.get(`/api/workspaces/${workspace.id}/snapshot`)
  ).json();
  await page.goto(`/w/${workspace.id}/t/${snapshot.topics[0].id}`);
  await page.route('**/api/topics/*/messages', async (route) => {
    if (route.request().method() === 'POST') {
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Message' }).fill('Persist this once');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send failed · Retry' })).toBeVisible();
  await page.unroute('**/api/topics/*/messages');
  await page.reload();
  await expect(page.getByText('Persist this once', { exact: true })).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('porch:outbox:'))
            .map((k) => JSON.parse(localStorage[k]))
            .flat().length,
      ),
    )
    .toBe(0);
});
test('human-only draft visibility survives switching topics and reload', async ({ page }) => {
  await page.request.post('/api/auth/dev', { data: { name: 'alex' } });
  const w = await (
    await page.request.post('/api/workspaces', { data: { name: `Draft ${Date.now()}` } })
  ).json();
  const s = await (await page.request.get(`/api/workspaces/${w.id}/snapshot`)).json();
  const second = await (
    await page.request.post(`/api/channels/${s.channels[0].id}/topics`, {
      data: { title: 'Another topic' },
    })
  ).json();
  await page.goto(`/w/${w.id}/t/${s.topics[0].id}`);
  await page.getByRole('button', { name: '◇ Humans only', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('PRIVATE_DRAFT_CANARY');
  await page.getByRole('button', { name: 'Another topic Start the conversation' }).click();
  await page.getByRole('button', { name: 'Welcome Start the conversation' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('PRIVATE_DRAFT_CANARY');
  await expect(page.getByRole('button', { name: '◈ Humans only', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '◈ Humans only', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
