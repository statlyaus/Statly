# AFL trade intelligence source-rights assessment

- Status: Gate 0A blocked; decision package prepared for external review
- Assessment date: 2026-08-03
- Scope: public, non-fantasy AFL trade intelligence
- Decision owner: an authorized Statly human reviewer, supported by provider and legal evidence

## Decision

No source reviewed in this assessment currently proves permission for the complete intended use:
historical capture, retained evidence, internal quality evaluation, model training, derived-feature
creation, public numerical output, and public fact display. Gate 0A therefore remains blocked.

This is an evidence assessment, not legal advice or an approval. Public availability, technical
access, an open-source client licence, or a downstream dataset label does not establish authority over
upstream AFL data. No capture, backfill, training, or numerical publication may begin from this
document.

The preferred path is a direct provider agreement or provider-authored export licence covering the
exact fields and operations below. A secondary path may combine independently approved sources, but
every field must have an unbroken rights chain and omitted uses remain denied by default.

## Required source lanes

The product cannot be supported by a match-results feed alone. Gate 0A needs approved evidence for all
three lanes, whether supplied by one provider or several:

1. **Transactions and asset lineage:** transaction identifiers and effective times; participating
   clubs; players; current and future pick entitlements; conditions; pick resolution and renumbering;
   on-trades; draft selections; voided or unsupported consideration; and corrections.
2. **Player contribution and availability:** stable player and club identifiers; match and season;
   selection and appearance; time or exposure denominator; role or position evidence; permitted
   performance measures; availability or absence evidence; and corrections.
3. **Point-in-time current state:** club custody, list status, age or birth date, permitted contract or
   tenure evidence, known departures, draft order and rules, and the recorded and effective times
   needed to prevent future information leaking into historical estimates.

Names, logos, images, editorial text, medical detail, and inferred sensitive attributes are not
required by default. They must not be collected merely because a candidate feed contains them.

## Candidate assessment

| Candidate                         | Technical contribution                                                                  | Rights evidence found                                                                                                                                                                                                                                                                              | Gate 0A result                                       | Reason                                                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AFL Data Platform / Champion Data | Strong candidate for player, match, squad, availability, and metadata fields            | The [official documentation](https://docs.api.afl.championdata.com/) describes authenticated endpoints, but no reviewed agreement grants Statly the required retention, training, derived-output, or public-display uses                                                                           | Blocked pending agreement                            | Authentication and endpoint documentation prove availability, not a licence for this product                                                                                                                                                            |
| Direct AFL or provider export     | Potentially covers transactions, draft lineage, current state, and official identifiers | The AFL states that products using AFL-owned intellectual property require a current [AFL Licensing Agreement](https://www.afl.com.au/news/123457/prospective-licensee-information)                                                                                                                | Blocked pending provider terms and authorized review | This is the preferred route, but no executed agreement or export terms are present                                                                                                                                                                      |
| Footywire through fitzRoy         | Existing technical path for player box statistics; may expose other public facts        | [fitzRoy](https://github.com/jimmyday12/fitzRoy) is MIT-licensed software that accesses several upstream sources; Footywire's [robots policy](https://www.footywire.com/robots.txt) restricts automated access to several statistics paths                                                         | Rejected for current proposal                        | The client licence does not sublicense upstream data, and no evidence grants training, retention, or public derived output                                                                                                                              |
| Community Kaggle AFL database     | Historical player and match tables                                                      | The [dataset card](https://www.kaggle.com/datasets/stoney71/aflstats) labels the database open but says its data came from AFL Tables and Footywire                                                                                                                                                | Rejected for current proposal                        | A downstream licence label does not cure missing upstream authority or prove the uploader could grant every required use                                                                                                                                |
| Squiggle API                      | Teams, fixtures, scores, standings, and model predictions                               | The [API requirements](https://api.squiggle.com.au/#requirements) allow commercial use but prohibit treating the service as a free production database backend for third-party user-facing sites; they also require builder-side access, identification, caching, bounded requests, and monitoring | Blocked pending explicit production-use terms        | Squiggle excludes advanced player statistics and cannot support player contribution, availability, trades, or pick lineage; any narrowly bounded server-side, cached public-site use still requires explicit provider terms and authorized human review |
| AFL Fantasy 2026 spreadsheet      | Three seasons of player statistics intended for fantasy draft preparation               | AFL makes the spreadsheet [free to download](https://www.afl.com.au/news/703301/download-now-the-2025-afl-fantasy-draft-kit), but the download invitation does not expressly grant reuse for a separate commercial model or public derived output                                                  | Rejected for current proposal                        | Free download and intended personal analysis do not establish the complete rights needed here                                                                                                                                                           |

Squiggle may later be proposed for a narrowly bounded supplemental fixture or score use only after
explicit provider terms cover the intended server-side, cached public deployment. It cannot be used
as a rationale to lower the required player, transaction, or lineage coverage.

## Why the apparent shortcuts fail

- **“The facts are public.”** Gate 0A evaluates the proposed acquisition and reuse, including database
  rights, contract terms, automated access, retention, attribution, and publication. It does not infer
  permission from visibility.
- **“The library is MIT.”** That licence governs fitzRoy code, not content retrieved from Footywire,
  AFL, AFL Tables, Fryzigg, or another upstream source.
- **“The dataset says ODbL.”** A downstream publisher can only grant rights it holds. The declared
  Footywire/AFL Tables provenance remains unresolved.
- **“Only derived values will be public.”** Training and feature creation are separate controlled
  operations. A prohibition on raw redistribution does not by itself authorize model training or
  derived publication.
- **“We already use these stats in fantasy.”** The trade engine is a separate public product. An
  existing fantasy ingestion path, account relationship, or internal dataset does not expand its
  permitted purpose.
- **“Users own the records.”** They do not. Public AFL players, picks, clubs, and transactions are not
  fantasy assets and are not owned by Statly users.

## Approval package required from a provider

The provider response or executed agreement must identify the contracting or authorizing entity and
answer every item below. Silence is a block, not an allow.

### Dataset and scope

- Exact product, export, endpoint, tables, fields, version, competitions, season ranges, update
  cadence, corrections policy, access mechanism, and upstream/subprocessor sources.
- Confirmation that the provider can grant the stated rights for each supplied field.
- Permitted geography, commercial context, audience, environments, and named Statly product.

### Operations

The response must separately allow, block, or mark not applicable:

- bounded evaluation capture;
- raw evidence retention;
- hashes and metadata retention;
- internal quality evaluation;
- model training;
- derived-feature creation;
- public derived numerical output;
- public display of source facts; and
- raw-field redistribution.

### Automation, retention, and withdrawal

- Required client identification, authentication, request and burst limits, retry rules, caching
  limits, permitted storage locations, and incident contact.
- Maximum retention for raw evidence, metadata, and derived artifacts; backup deletion; audit records
  that may remain; and whether already-published derived values must be withdrawn.
- Exact duties after expiry, termination, provider correction, or withdrawal: stop collection, stop
  new derived work, reassess public output, delete or quarantine material, and document completion.

### Attribution and public presentation

- Exact attribution text, link, logo or trademark restrictions, placement, persistence, and whether
  attribution is required in APIs, methodology pages, trade detail, downloads, or all of them.
- Whether player names, club names, pick descriptions, transaction facts, source statistics,
  uncertainty intervals, explanations, and aggregate model values may be shown publicly.
- Confirmation that no public wording may imply provider endorsement, official status, or ownership.

## Internal approval record

An authorized reviewer must archive immutable copies or provider-authenticated references for:

1. the executed agreement, export licence, or provider terms and their effective date;
2. the provider's field dictionary and any field-specific restrictions;
3. the approved product description and public presentation examples;
4. rate, cache, retention, attribution, termination, and withdrawal schedules;
5. the signer's provider authority and the Statly approver's decision authority; and
6. any legal interpretation on which a disposition depends.

Those evidence items are then referenced by an exact `source-rights:` proposal and an append-only
Gate 0A decision. The repository's evaluator may return `mechanically_eligible` only after the request
matches that approved environment, dataset version, scope, operations, fields, uses, retention,
conditions, and current revalidation date. Mechanical eligibility still does not create legal
authority.

## Minimum acceptance criteria

Gate 0A can pass only when all of the following are true:

- every required source lane has a named provider and an unbroken rights chain;
- every requested operation and field use has an explicit disposition;
- raw, metadata, and derived retention are bounded and implementable;
- automated access, caching, attribution, restrictions, expiry, and withdrawal are machine-encodable;
- the approved source set can be isolated by environment and dataset version;
- immutable authority evidence and an externally recorded human decision exist;
- the exact approved bytes validate against the repository contracts; and
- no decision relies on the existing fantasy purpose, user ownership, technical accessibility, or an
  unverified downstream licence.

## Next action

Statly should request terms and a field-level sample from the AFL/Champion Data channel first because
it is the only reviewed candidate plausibly capable of satisfying the player-contribution lane with
official identifiers and corrections. The same request must ask whether transaction, pick-lineage,
and current-state feeds are available; otherwise those lanes need separate provider agreements.

Until an authorized response is captured, the correct public state remains `source_blocked`. Gate 0B,
historical ingestion, model fitting, numerical valuation, and publication remain unavailable.
