# Hybrid repository and runtime ontology

- Status: accepted knowledge-model contract
- Last verified against source: 2026-08-30

## Purpose

Statly's ontology gives humans and tools one machine-readable model of the product domain, repository,
and supported local runtime. It combines two substrates without confusing them:

- the **symbolic substrate** records declared concepts, typed relations, ownership, scope, and
  invariants that are true by contract; and
- the **probabilistic substrate** records observations, hypotheses, confidence, and evidence lineage
  for relationships that are useful but not authoritative.

The machine-readable kernel is [`config/ontology/statly.ontology.json`](../../config/ontology/statly.ontology.json).
Its structure is governed by
[`config/ontology/statly.ontology.schema.json`](../../config/ontology/statly.ontology.schema.json).
Canonical domain and architecture documents remain the explanatory sources of truth. The ontology
indexes and connects those sources rather than replacing them.

## Epistemic model

Every statement has one epistemic state:

| State      | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `asserted` | A contract established by canonical source, schema, or configuration.  |
| `observed` | A directly inspected fact about the current repository or environment. |
| `inferred` | A defeasible interpretation supported by one or more observations.     |
| `rejected` | A known-invalid interpretation retained to prevent its reintroduction. |

An asserted statement may be changed only by changing its owning source and reviewing the resulting
contract. Observations can become stale. Inferences can gain or lose confidence. Rejected statements
remain queryable so an agent can explain why a tempting model is unsafe.

### Authority ordering

When statements conflict, resolve them in this order:

1. safety and authorization invariants;
2. canonical domain and architecture sources;
3. executable schema, types, and configuration;
4. direct repository or runtime observations;
5. probabilistic inferences.

Confidence is not authority. No quantity of inferred evidence can make Firestore the owner of
protected fantasy state, make Redis durable, remove league or season scope, or turn authentication
into authorization.

## Symbolic substrate

The symbolic graph contains stable node kinds such as domain concepts, modules, interfaces, runtime
processes, stores, external systems, repository artifacts, and development capabilities. Relations
are directional and typed. Core relation families include:

- `owns`, `authorizes`, and `scopes` for domain authority;
- `implements`, `exposes`, and `depends_on` for module structure;
- `reads_from`, `writes_to`, `projects_to`, and `coordinates_via` for data flow;
- `runs_as`, `starts_with`, and `verified_by` for the local runtime; and
- `defined_by` and `documented_by` for provenance.

Symbolic statements carry evidence references even when asserted. This makes the graph explainable
and lets validation detect dangling or underspecified claims.

### Protected invariants

The kernel must preserve these non-negotiable statements:

- Firebase Authentication establishes identity; server/domain logic establishes authorization.
- Prisma services own protected league, season, membership, draft, pick, roster, lineup, matchup,
  trade, and waiver state.
- Every protected operation retains league scope and season scope where applicable.
- Firestore contains ingestion evidence or compatibility projections, not canonical protected state.
- Redis coordinates ephemeral queues, locks, caches, and delivery; it does not own durable truth.
- Socket.IO transports server-authoritative commands and events; successful realtime behavior must
  converge on persisted state and survive reconnect.
- Footywire through fitzRoy is external AFL evidence and fails closed in production.
- Local and test data must be disposable or explicitly selected; `prisma/dev.db` is never a test
  target.

## Probabilistic substrate

The probabilistic graph represents useful uncertainty explicitly. A hypothesis has:

- a subject, predicate, and object compatible with the symbolic vocabulary;
- a probability in the closed interval `[0, 1]`;
- a calibration label (`low`, `medium`, `high`, or `near_certain`);
- one or more supporting or contradicting evidence links; and
- a lineage recording how the belief was derived.

Probabilities describe belief about a statement, not frequency in the product domain. They should be
calibrated from evidence quality rather than invented precision. The default interpretation is:

| Calibration    | Probability range | Intended use                                  |
| -------------- | ----------------- | --------------------------------------------- |
| `low`          | 0.00–0.49         | Weak lead; do not plan changes from it alone. |
| `medium`       | 0.50–0.79         | Plausible; inspect the owning source.         |
| `high`         | 0.80–0.94         | Strong evidence; still defeasible.            |
| `near_certain` | 0.95–1.00         | Directly corroborated but not asserted.       |

Belief updates use evidence items rather than mutating symbolic facts. Independent corroborating
evidence may increase confidence; copied or causally dependent evidence must not be double-counted.
A contradiction lowers confidence or creates a competing hypothesis. When an owning source resolves
the question, the result becomes a separately reviewed assertion and the old hypothesis is retired,
not silently promoted.

## Neural lineage

“Neural lineage” is the trace from a semantic association back to the material that suggested it.
The ontology does not store model weights or claim that embeddings are explanations. It records the
inspectable derivation around neural or heuristic work:

```text
artifact or runtime observation
  -> extracted feature or semantic signal
  -> inference operation and model/tool identity
  -> hypothesis with calibrated confidence
  -> later corroboration, contradiction, or retirement
```

Each lineage step names its inputs and operation. Optional embedding references may identify an
external vector and model version, but the kernel must not contain secret material, source-file
contents, model prompts containing credentials, or opaque vectors presented as proof.

## Repository and local-environment boundary

The ontology models supported capabilities, not the developer's private machine state. It may record
that Statly requires Node 22, npm, Git, Firebase emulators, Redis, R for ETL, and optional Docker
services. It must not read or record `.env*`, credentials, service-account JSON, local database
contents, shell history, usernames, absolute home paths, or untracked personal files.

Repository evidence uses root-relative paths. Runtime observations should record a capability or
process class, not a credential-bearing command line. Generated build directories, dependency trees,
and local databases are excluded from discovery.

## Query and agent semantics

A consumer should query both substrates and preserve their distinction. Examples:

- “Who owns roster state?” returns the asserted Prisma ownership edge and its canonical evidence.
- “Which module probably owns this route?” may return ranked inferred edges with lineages.
- “Can Firestore satisfy this write?” returns the rejected authority edge and the invariant it would
  violate.
- “What is needed locally for draft realtime?” traverses process, Redis, Socket.IO, worker, and
  verification relationships without exposing local secrets.

Agents must cite the relevant evidence before proposing a change based on an inference. A query
result with only probabilistic support is a navigation aid, not authorization to edit an owning
boundary.

## Evolution rules

1. Change canonical domain or architecture sources before changing an asserted contract they own.
2. Give every node, statement, evidence item, hypothesis, and lineage step a stable namespaced ID.
3. Retain rejected or retired hypotheses when they prevent a recurring unsafe interpretation.
4. Update observations when repository structure or supported local processes change.
5. Validate references, probability bounds, calibration bands, lineage connectivity, and protected
   invariants with `npm run ontology:check`.
6. Never auto-promote an inference to an assertion.
