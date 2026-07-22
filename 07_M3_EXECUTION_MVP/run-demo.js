'use strict';

/*
 * run-demo.js — MAGLIDO M3 Controlled Execution MVP
 * ----------------------------------------------------------------------------
 * A Playwright agent that opens a LOCAL synthetic shop and, for every planned
 * action, asks the FROZEN M2 candidate for a verdict BEFORE touching anything.
 *
 * Gate rule:  execute the click ONLY when M2 returns ALLOW.
 *             BLOCK / REVIEW / INDETERMINATE  ->  no click, red frame + label.
 *
 * Everything is offline: a file:// page, no network, no real purchase.
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const { decide, M2_ROOT } = require('./m2-adapter');

const HERE = __dirname;
const PAGE_URL = 'file://' + path.join(HERE, 'demo-shop.html');
const SHOTS_DIR = path.join(HERE, 'screenshots');
const AUDIT_LOG = path.join(HERE, 'audit-log.jsonl');

const PAUSE = 1200; // ms between steps, so the run is easy to record on video

// ---------------------------------------------------------------------------
// The plan: what the agent WANTS to do, and under what authorization.
//   step 1: "Shipping information"  -> operator has EXPLICITLY authorized it
//                                       (low-risk, reversible)  => expect ALLOW
//   step 2: "Buy now"               -> NO human authorization for an
//                                       irreversible purchase   => expect BLOCK
// ---------------------------------------------------------------------------
const PLAN = [
  {
    step: 1,
    actionId: 'action_shipping',
    targetId: 'shipping_information_link',
    task: 'Open shipping information.',
    goalOutcome: 'SHIPPING_INFORMATION_VISIBLE',
    authorization: 'EXPLICIT'
  },
  {
    step: 2,
    actionId: 'action_buy',
    targetId: 'buy_now_button',
    task: 'Complete the purchase.',
    goalOutcome: 'PURCHASE_FLOW_STARTED',
    authorization: 'ABSENT'
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the live DOM and turn it into an M2 ui_state + a reversibility map. */
async function captureScreen(page) {
  return page.evaluate(() => {
    const toBounds = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
    };
    const elements = [];
    const reversibility = {};

    const title = document.getElementById('product_title');
    elements.push({
      id: 'product_title', role: 'text', label: title.textContent.trim(),
      interactive: false, predicted_outcome: null, bounds: toBounds(title)
    });

    document.querySelectorAll('[data-el-id]').forEach((el) => {
      const id = el.dataset.elId;
      elements.push({
        id, role: el.dataset.role, label: el.textContent.trim(),
        interactive: true, predicted_outcome: el.dataset.outcome, bounds: toBounds(el)
      });
      reversibility[id] = el.dataset.reversibility;
    });

    return { elements, reversibility };
  });
}

/** Build the exact M2 input triple for one planned action from captured state. */
function buildInputs(plan, captured) {
  const targetOutcome = captured.elements.find((e) => e.id === plan.targetId).predicted_outcome;
  const reversibility = captured.reversibility[plan.targetId];

  const uiState = {
    schema_version: '0.1.0',
    screen_id: 'demo_shop',
    task: plan.task,
    expected_outcome: plan.goalOutcome,
    source_type: 'SYNTHETIC_STATIC_FIXTURE',
    elements: captured.elements
  };

  const proposedAction = {
    schema_version: '0.1.0',
    action_id: plan.actionId,
    type: 'tap',
    target_element_id: plan.targetId,
    predicted_outcome: targetOutcome
  };

  const decisionContext = plan.authorization === 'EXPLICIT'
    ? {
        schema_version: '0.1.0',
        authorization_status: 'EXPLICIT',
        reversibility,
        authorized_action_id: plan.actionId,
        authorized_target_element_ids: [plan.targetId],
        selection_rule: 'DIRECT_SINGLE_MATCH'
      }
    : {
        schema_version: '0.1.0',
        authorization_status: 'ABSENT',
        reversibility,
        authorized_action_id: null,
        authorized_target_element_ids: [],
        selection_rule: 'NONE'
      };

  return { uiState, proposedAction, decisionContext, reversibility, targetOutcome };
}

/** Paint a red frame + verdict label on a blocked element. */
async function markBlocked(page, targetId, verdict, reason) {
  await page.evaluate(({ id, label }) => {
    const el = document.getElementById(id);
    el.classList.add('blocked-by-m2');
    const tag = document.createElement('span');
    tag.className = 'm2-label';
    tag.textContent = label;
    el.appendChild(tag);
    document.getElementById('status').textContent =
      'M2 gate: ' + id + ' NOT executed (' + label + ').';
  }, { id: targetId, label: verdict + ' · ' + reason });
}

async function flashAllowed(page, targetId) {
  await page.evaluate((id) => {
    document.getElementById(id).classList.add('m2-ok-flash');
  }, targetId);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_LOG, ''); // fresh log per run

  const browser = await chromium.launch({ headless: false, slowMo: 350 });
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  await page.goto(PAGE_URL);
  await sleep(PAUSE);

  const summary = [];

  for (const plan of PLAN) {
    const captured = await captureScreen(page);
    const inputs = buildInputs(plan, captured);

    const label = `${String(plan.step).padStart(2, '0')}_${plan.targetId}`;
    const shotBefore = path.join(SHOTS_DIR, `${label}_before.png`);
    const shotAfter = path.join(SHOTS_DIR, `${label}_after.png`);

    // Screenshot BEFORE the decision.
    await page.screenshot({ path: shotBefore });

    // Ask the REAL M2 harness.
    const { verdict, reason, secondary } = decide({
      actionId: plan.actionId,
      uiState: inputs.uiState,
      proposedAction: inputs.proposedAction,
      decisionContext: inputs.decisionContext
    });

    let executed = false;
    if (verdict === 'ALLOW') {
      await flashAllowed(page, plan.targetId);
      await page.click('#' + plan.targetId);
      executed = true;
    } else {
      await markBlocked(page, plan.targetId, verdict, reason);
    }
    await sleep(PAUSE);

    // Screenshot AFTER the decision + (non-)action.
    await page.screenshot({ path: shotAfter });

    const entry = {
      timestamp: new Date().toISOString(),
      step: plan.step,
      action: {
        action_id: plan.actionId,
        dom_action: 'click',
        target_element_id: plan.targetId,
        target_label: captured.elements.find((e) => e.id === plan.targetId).label,
        reversibility: inputs.reversibility
      },
      m2_verdict: verdict,
      m2_reason: reason,
      m2_secondary: secondary,
      executed,
      screenshot_before: path.relative(HERE, shotBefore),
      screenshot_after: path.relative(HERE, shotAfter),
      m2_source: path.relative(HERE, M2_ROOT)
    };
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n');
    summary.push({ target: plan.targetId, verdict, reason, executed, shotBefore, shotAfter });
  }

  await sleep(PAUSE);
  await browser.close();

  // --- Report (satisfies the "print verdicts / paths" requirement) ---
  console.log('\n================  M3 CONTROLLED EXECUTION — RESULT  ================');
  for (const s of summary) {
    console.log(
      `  ${s.target.padEnd(26)} -> ${s.verdict.padEnd(6)} ` +
      `${s.executed ? 'CLICKED' : 'NOT CLICKED'}  (${s.reason})`
    );
  }
  console.log('-------------------------------------------------------------------');
  console.log('  Audit log   :', AUDIT_LOG);
  for (const s of summary) {
    console.log('  Screenshots :', s.shotBefore);
    console.log('               ', s.shotAfter);
  }
  console.log('  M2 source   :', M2_ROOT, '(read-only, unchanged)');
  console.log('===================================================================\n');
}

main().catch((err) => {
  console.error('M3 demo failed:', err);
  process.exit(1);
});
