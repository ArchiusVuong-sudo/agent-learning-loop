/**
 * Walks the whole main flow in a real browser and saves a screenshot of each screen at 1440x900.
 * It doubles as a UI check: it fails on any console error or failed step.
 *
 *   BASE_URL=http://127.0.0.1:4101 pnpm screenshots ./shots
 *
 * Start the app on an empty data folder first (replay mode is fine: DEMO_REPLAY=1).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4101';
const out = path.resolve(process.argv[2] ?? 'shots');
const errors: string[] = [];

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
  console.log(`saved ${name}.png`);
}

async function waitForJob(page: Page, timeoutMs = 240_000) {
  await page.waitForFunction(
    async () => {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      const jobs = (await res.json()) as Record<string, { status: string }>;
      return Object.values(jobs).every((job) => job.status !== 'running');
    },
    undefined,
    { timeout: timeoutMs, polling: 1000 },
  );
  await page.waitForTimeout(2500);
}

async function runGate(page: Page) {
  await page.goto(`${base}/gate`);
  await page.getByRole('button', { name: /Run gate/ }).click();
  await page.waitForTimeout(2500);
  if (!existsSync(path.join(out, '09-gate-running.png'))) await shot(page, '09-gate-running');
  await waitForJob(page, 400_000);
  await page.reload();
  await page.getByText('Matrix').waitFor();
}

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${page.url()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`${page.url()}: ${err.message}`));

    await page.goto(`${base}/traces`);
    await shot(page, '01-traces-empty');
    await page.getByRole('button', { name: /Run synthetic traffic/ }).click();
    await page.waitForTimeout(1500);
    await shot(page, '02-traffic-running');
    await waitForJob(page);

    // The three suggested messages, in order, the same way the recorded walkthrough sends them.
    for (const start of [/^I opened my trail headphones/, /^Bram Visser here/, /^Can you cancel/]) {
      const rows = page.locator('[id^=trace-]');
      const before = await rows.count();
      await page.getByRole('button', { name: start }).click();
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction((n) => document.querySelectorAll('[id^=trace-]').length > n, before, { timeout: 120_000 });
      await page.getByText('Agent reply').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[id^=trace-]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot(page, '03-try-trace');

    await page.goto(`${base}/traces#S08`);
    await page.getByText('Agent reply').first().waitFor();
    await shot(page, '04-failed-trace');

    await page.goto(`${base}/findings`);
    await page.getByRole('button', { name: /Analyze \d+ trace/ }).click();
    await waitForJob(page);
    await page.reload();
    await shot(page, '05-findings');

    await page.goto(`${base}/evals`);
    await page.getByRole('button', { name: 'Propose cases', exact: true }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).first().waitFor({ timeout: 120_000 });
    const firstMust = page.getByLabel('Must line 1').first();
    await firstMust.fill(`${await firstMust.inputValue()} (checked by a person)`);
    await shot(page, '06-cases-drafted');
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: /^(Approve|Save and approve)$/ }).first().click();
      await page.waitForTimeout(1200);
    }
    await page.getByRole('button', { name: 'Reject', exact: true }).nth(3).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Add 3 to dataset/ }).click();
    await page.getByText('In dataset v2').first().waitFor();
    await shot(page, '07-cases-added');

    await page.goto(`${base}/suggestion`);
    await page.getByRole('button', { name: 'Suggest fix', exact: true }).click();
    await page.getByRole('button', { name: /Approve as v2/ }).waitFor({ timeout: 180_000 });
    await shot(page, '08-suggestion');
    await page.getByRole('button', { name: /Approve as v2/ }).click();
    await page.getByText('Saved as candidate v2').waitFor();

    await runGate(page);
    await shot(page, '10-gate-failed');
    // A failed gate sends its failing rows back to the learner, up to two revisions.
    for (let revision = 0; revision < 2 && (await page.getByText(/^Gate failed/).count()) > 0; revision++) {
      await page.goto(`${base}/suggestion`);
      await page.getByRole('button', { name: 'Revise from gate results', exact: true }).click();
      const approve = page.getByRole('button', { name: /Approve as v\d+/ });
      await approve.waitFor({ timeout: 180_000 });
      if (revision === 0) await shot(page, '11-revision');
      await approve.click();
      await page.getByText(/Saved as candidate v\d+/).first().waitFor();
      await runGate(page);
    }
    await page.getByText(/^Gate passed/).first().waitFor();
    await shot(page, '12-gate-passed');
    await page.locator('td .group').nth(1).hover();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(400);
    await page.locator('td .group').nth(3).hover();
    await shot(page, '13-gate-matrix');

    await page.goto(`${base}/rollout`);
    await page.getByRole('button', { name: 'Start shadow run', exact: true }).click();
    await waitForJob(page, 400_000);
    await page.reload();
    await shot(page, '14-shadow');
    await page.getByRole('button', { name: /Promote v\d+/ }).click();
    await page.waitForURL('**/versions');
    await page.getByRole('heading', { name: 'Audit log' }).waitFor();
    await shot(page, '15-versions');
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error(`console errors:\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log('UI walk finished with no console errors');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
