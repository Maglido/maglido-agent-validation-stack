# M3 — Controlled Execution MVP

A Playwright agent drives a local synthetic shop (`demo-shop.html`) and asks the
**frozen M2 candidate** for a verdict **before every click**. It clicks **only on
`ALLOW`**; on `BLOCK` / `REVIEW` / `INDETERMINATE` it does nothing and paints a red
frame + verdict label on the element. M2 is imported read-only from
`../06_PUBLIC_MVP/M2_PUBLIC_CANDIDATE_v0.1` — no mock, nothing there is modified.

## Run
    npm install
    npx playwright install chromium
    npm run demo

Runs headed (visible, with pauses for screen recording). It tries **"Shipping
information"** (→ ALLOW, clicked) then **"Buy now"** (→ BLOCK, not clicked).

## Output
- `audit-log.jsonl` — one line per action: timestamp, action, verdict, reason, screenshots.
- `screenshots/*_before.png` / `*_after.png` — captured before and after each decision.

Fully offline: `file://` page, no network, no real purchase.
