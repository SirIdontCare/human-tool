# FOUNDING_SPEC.md

## 0. Status
**Stage:** Pre-MVP  
**Initial market:** United States  
**Demand:** Global, English-first  
**Company model:** AI-native, extremely lean  
**Primary interface:** AI agents, not humans

## 1. Vision
Give every AI agent reliable access to human capability.

AI should be able to obtain human expertise, judgment, verification and real-world execution as naturally as it currently uses search, code or APIs.

The long-term goal is for human capability to become a standard tool in the agent stack.

## 2. Core Product Thesis
We are **not building a freelancer marketplace for AI**.

We are building:

> **Human capability as infrastructure for AI agents.**

The agent requests an outcome.

The platform handles:
- task classification,
- capability matching,
- pricing,
- human selection,
- qualification,
- delivery,
- verification,
- payment,
- structured result.

The agent should not need to browse profiles, negotiate with freelancers or manage humans.

## 3. North Star
Desired mental model:

```text
AI cannot complete something reliably
↓
AI calls our tool
↓
Human capability becomes available
↓
AI continues the workflow
```

Eventually:

```text
CAN'T
UNSURE
NEEDS EXPERT
NEEDS PHYSICAL WORLD
HIGH CONSEQUENCE
↓
consider human capability
```

We want to become the default human capability layer for AI agents.

## 4. Primary Metric
### North Star Metric
**Successful agent-initiated human tasks per week**

A successful task means:
1. initiated through an AI/agent workflow,
2. accepted by the platform,
3. completed by a human,
4. result delivered back to the agent,
5. accepted as usable.

Secondary metrics:
- Agent-initiated GMV
- Repeat agent usage
- Task success rate
- Median time to human acceptance
- Median completion time
- Price accuracy
- Human utilization
- Human result acceptance rate

Worker registrations are **not** a core success metric.

## 5. Initial Market
### Phase 1
**United States**

Reasons:
- large AI/startup ecosystem,
- high willingness to pay for expertise,
- English-native,
- strong developer ecosystem,
- high-value professional services,
- cleaner initial pricing dataset.

Demand may come globally.

Supply initially focuses primarily on US-relevant capabilities.

### Later expansion
1. United States
2. United Kingdom
3. Canada / Australia
4. selected additional markets
5. EU expansion after regulatory/compliance architecture is mature

Global availability is not a launch objective.

## 6. Initial Wedge
We start with tasks where:
- AI already performs most of the work,
- human expertise materially improves the result,
- the task can be clearly scoped,
- output can be structured,
- completion can be verified,
- willingness to pay is meaningful.

Priority categories:
- Product / UX
- Software / Engineering
- Expert verification / Human Oracle
- Legal as a private pilot after compliance review
- Physical-world tasks mainly for demos/viral distribution initially

## 7. Human Oracle
An important task class is not full outsourcing.

It is:

> **AI performs 90–95% of the task and asks a human to verify the critical remainder.**

This allows expensive human expertise to be sold in small units.

## 8. Core Agent Interface
Initial conceptual tools:

```text
quote_human()
call_human()
get_result()
```

The agent should not select a particular human unless there is a specific reason.

## 9. Human Task Protocol — HTP
Every supported human task should have a machine-readable definition.

Minimum structure:

```text
task_type
task_description
required_capabilities
jurisdiction
inputs
expected_output
result_schema
proof_required
risk_level
deadline
price
estimated_completion
```

## 10. Pricing
No bidding marketplace at launch.

The agent receives a predictable price.

Initially pricing is manually defined.
Every transaction must capture the data required to improve pricing.

## 11. Human Work Pricing Model
Long-term asset: a model capable of predicting:
- optimal task price,
- probability of acceptance,
- expected completion time,
- expected result quality.

## 12. Human Capability Model
Ratings alone are insufficient.

We need machine-readable understanding of what each human can reliably do.

The system should eventually answer:

> Which available human has the highest expected probability of successfully completing this exact task?

## 13. Qualification
Qualification depth depends on task risk and value.

Low-risk workers:
- identity,
- payment verification,
- basic reliability.

Professional experts:
- identity,
- credential verification,
- jurisdiction,
- professional specialization,
- practical capability test,
- historical performance.

Conversational AI/video may be used to perform structured qualification interviews.

It must assess task-relevant competence, not emotion, personality or pseudo-psychological signals.

## 14. Proof of Work
Each task class defines its own proof requirements.

AI should be able to verify as much proof as possible automatically.

## 15. Worker Experience
Optimize for:
- extremely fast task understanding,
- clear guaranteed compensation,
- minimal administrative work,
- fast payment,
- reputation based on real performance.

Workers should not negotiate prices for standardized tasks.

## 16. Compensation
Every task has guaranteed compensation.

Optional bonuses may exist, but never replace or reduce guaranteed fair compensation.

## 17. Safety
Reject tasks involving:
- fraud,
- impersonation,
- bypassing authentication,
- unlawful surveillance,
- illegal activity,
- coercion,
- harmful manipulation,
- credential theft,
- malicious physical actions.

High-risk task classes require stronger screening.

## 18. Agent Discovery
Distribution is part of the product.

Priority:
1. MCP
2. ChatGPT / Codex ecosystem
3. Claude ecosystem
4. Gemini ecosystem
5. REST API
6. Python SDK
7. TypeScript SDK
8. agent frameworks
9. automation platforms

Documentation should explicitly teach agents when the tool should be considered.

## 19. AI-Native Company
Default organizational rule:

> Do not hire a human for an internal company role until we have demonstrated that AI cannot perform it sufficiently well.

Humans are used where:
- legal responsibility requires them,
- regulated expertise requires them,
- high-value relationships require them,
- AI performance is demonstrably inadequate.

## 20. Data Moat
Every task should generate structured data about:
- task type,
- capability,
- price,
- acceptance,
- completion,
- human selected,
- quality,
- rework,
- agent feedback.

Long-term assets:
- Human Capability Graph
- Human Work Pricing Model
- Human Routing Model

## 21. Fundraising
No active fundraising initially.

Company remains **fundable at all times**.

Inbound investor conversations are welcome.
Capital should primarily accelerate something already demonstrating demand.

## 22. What We Are NOT Building Yet
Do not build prematurely:
- huge worker social network,
- freelancer bidding,
- complicated profile browsing,
- worker feeds,
- full native mobile apps,
- internal payment infrastructure,
- internal KYC infrastructure,
- elaborate chat system,
- dozens of countries,
- hundreds of task categories,
- large internal workforce.

## 23. Initial Validation
First milestone:

```text
AI
↓
recognizes need for human capability
↓
requests quote
↓
human accepts
↓
human executes
↓
result returns to AI
↓
AI successfully continues workflow
```

## 24. First 100 Tasks
The first 100 completed tasks are primarily research.

For every task ask:
- Why did AI require a human?
- Could AI have completed it differently?
- Was the human asked too much?
- Could the intervention have been smaller?
- Was price correct?
- Was SLA correct?
- Was the correct person selected?
- Was the result machine-readable?
- Did the agent use the result?
- Would the agent/customer use us again?

## 25. Pivot Philosophy
The mission is persistent.
The implementation is not.

Core mission:

> Give AI reliable access to human capability.

## 26. Founder Operating Principle
Truth over validation.

Ideas, assumptions and decisions should be challenged when evidence suggests they are weak.

## 27. Immediate Objective
Build the smallest system capable of producing a real:

**agent → human → result**

transaction.

Then repeat.
Then measure.
Then improve.
