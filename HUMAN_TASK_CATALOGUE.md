# HUMAN_TASK_CATALOGUE.md

## 0. Goal
Build the first offer of human capabilities that **an AI agent can buy like an API**.

We do not sell human hours.
We sell:

> **specific outcome + price + SLA + required capability + structured output**

## 1. Catalogue Rules
Each product should satisfy most of:
1. AI can perform part of the work before handoff.
2. Human adds real value beyond another model.
3. Task can be tightly scoped.
4. Result can be structured.
5. Agent can continue with the result.
6. Price can be predictable without negotiation.
7. Turnaround is minutes/hours, not days.
8. Result can be evaluated.
9. Customer understands what is being purchased.
10. Repetition generates useful data.

## 2. Pricing v0
No auction or bidding at launch.

Initial target:
- Expert payout: 60–75%
- Platform gross margin: 25–40%

Prices are hypotheses, not truth.

## 3. Initial Task Catalogue

### H001 — Landing Page Conversion Review
**Price:** $39  
**Target payout:** $25  
**SLA:** 30 min  
**Risk:** LOW  
**MVP:** YES

Structured output:
```json
{
  "top_issues": [],
  "highest_impact_change": "",
  "conversion_blockers": [],
  "confidence": 0.0
}
```

### H002 — Architecture Sanity Check
**Price:** $69  
**Target payout:** $45  
**SLA:** 60 min  
**Risk:** MEDIUM  
**MVP:** YES

Structured output:
```json
{
  "verdict": "good|acceptable|risky",
  "critical_issues": [],
  "recommended_changes": [],
  "scaling_risks": [],
  "confidence": 0.0
}
```

### H003 — Expert Fact Verification
**Price:** $29  
**Target payout:** $18  
**SLA:** 30 min  
**Risk:** LOW  
**MVP:** YES

Agent submits a claim + context + sources.
Expert returns:
- true / false / partial / cannot confirm,
- concise explanation,
- confidence,
- source note if relevant.

### H004 — Contract Clause Risk Check
**Price hypothesis:** $49  
**Target payout:** $32  
**SLA:** 30–60 min  
**Risk:** HIGH  
**MVP:** PRIVATE PILOT ONLY AFTER COMPLIANCE REVIEW

### H005 — Local Photo Verification
**Price:** dynamic, start from $15 + distance modifier  
**Target payout:** ~70%  
**SLA:** 30–120 min  
**Risk:** LOW/MEDIUM  
**MVP:** DEMO / VIRAL TASK

Proof may include:
- GPS,
- timestamp,
- required angles,
- photo metadata.

## 4. MVP Core
Sprint 1 implements only:
1. LANDING_PAGE_REVIEW
2. ARCHITECTURE_SANITY_CHECK
3. EXPERT_FACT_VERIFICATION

Legal is deferred to a controlled private pilot.
Physical verification is initially a demo path, not core supply.

## 5. Agent UX
Agent should be able to call:

```text
quote_human()
call_human()
get_result()
```

Quote response should include:
- available,
- price,
- ETA,
- capability,
- expected confidence where available.

## 6. Scope Reduction
A core economic mechanism:

AI should reduce the human's task before escalation whenever possible.

Example:

```text
AI reviews full artifact
↓
identifies uncertainty
↓
asks human only the critical question
↓
human responds
↓
AI completes final output
```

## 7. Required Dataset
For every quote:
- task_type
- timestamp
- agent_type
- complexity
- jurisdiction
- urgency
- quoted_price

For every offer:
- expert_id
- payout
- accept/reject
- response_time

For every completion:
- completion_time
- estimated human minutes
- result
- confidence
- AI acceptance
- customer acceptance
- rework_required

## 8. Pricing Experiment
Prices above are starting hypotheses.

Track:
- quote → purchase conversion,
- expert acceptance,
- time to completion,
- repeat usage,
- quality.

## 9. Qualification v0
Initial supply can be tiny:
- 1 primary + 1 backup per category is enough for validation.

Do not recruit supply for vanity metrics.

Tavus qualification is reserved initially for high-value or high-risk experts, not every worker.

## 10. First Magic Moment
Agent says approximately:

> I’m not confident enough to answer this reliably.  
> I can have a qualified human expert verify it for $X.  
> Expected turnaround: Y minutes.

User approves.

The human result returns to the agent, and the agent continues the workflow.

## 11. Critical Hypothesis
The main thing we must validate:

> **Will people using AI agents pay an additional $20–$100 often enough for the agent to improve the outcome through a human?**

If yes, scale.
If no, shift toward enterprise, physical-world execution, regulated validation, AI labs, or larger task units.
