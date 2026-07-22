'use strict';

/*
 * m2-adapter.js
 * ----------------------------------------------------------------------------
 * Thin, READ-ONLY bridge to the FROZEN M2 public candidate.
 *
 * It does NOT re-implement or mock any decision logic. It calls the real
 * decision function `runCase` from:
 *   ../06_PUBLIC_MVP/M2_PUBLIC_CANDIDATE_v0.1/src/run-case.js
 *
 * runCase accepts `inputOverrides`, so M3 can inject live (uiState,
 * proposedAction, decisionContext) triples WITHOUT writing any file into the
 * frozen M2 tree. The returned record's `final_state` is exactly one of:
 *   ALLOW | BLOCK | REVIEW | INDETERMINATE
 */

const path = require('node:path');

const M2_ROOT = path.resolve(
  __dirname,
  '..',
  '06_PUBLIC_MVP',
  'M2_PUBLIC_CANDIDATE_v0.1'
);

// The real M2 decision entrypoint (no copy, no mock).
const { runCase } = require(path.join(M2_ROOT, 'src', 'run-case'));

/**
 * Ask the real M2 harness to classify a single proposed action.
 *
 * @param {object} params
 * @param {string} params.actionId        stable id for this planned action
 * @param {object} params.uiState         M2 ui_state object (derived from the page)
 * @param {object} params.proposedAction  M2 proposed_action object
 * @param {object} params.decisionContext M2 decision_context object
 * @returns {{verdict:string, reason:string, secondary:string[], record:object}}
 */
function decide({ actionId, uiState, proposedAction, decisionContext }) {
  const caseDefinition = {
    id: `M3-${actionId}`,
    // These are only labels for the record's input_paths; the real inputs
    // are injected below via inputOverrides (nothing is read from disk).
    uiState: 'inline://m3/ui_state',
    proposedAction: 'inline://m3/proposed_action',
    decisionContext: 'inline://m3/decision_context',
    omitEvidence: []
  };

  const result = runCase(caseDefinition, {
    inputOverrides: { uiState, proposedAction, decisionContext }
  });

  return {
    verdict: result.record.final_state,
    reason: result.record.primary_reason_code,
    secondary: result.record.secondary_reason_codes,
    record: result.record
  };
}

module.exports = { decide, M2_ROOT };
