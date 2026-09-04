# Official AFL `ratingPoints` source assessment

Status: evidence assessment for issue #574. This note authorises no capture or use.

## Decision

**No-go under the current evidence:** Official AFL `ratingPoints` must not be used for
model training, target construction, or validation yet. The repository has no reviewed
Gate 0A authority for retaining and deriving from the historical Official AFL response,
and no representative capture proves complete, stable 2021–2025 coverage.

If both gates are later passed, the first admitted use should be a versioned **shadow
validation target**, not an immediate replacement for the existing four-metric scalar.
Promotion to a primary target would require a separate methodology decision and a new
outcome-contract version.

## What the two ratings mean

They are different quantities:

- A **match score** assigns points to one player's actions in one match. The AFL says an
  action may add or subtract points according to its effect on the team's chance of the
  next score, and describes the underlying match measure as the total scoreboard
  contribution of player actions. Negative match values are therefore semantically
  valid. See the AFL's [Player Ratings FAQ](https://www.afl.com.au/news/453167/player-ratings-frequently-asked-questions)
  and [methodology PDF](https://s.afl.com.au/staticfile/AFL%20Tenant/AFL/PlayerRatings/PlayerRatings_HOW.pdf).
- The **Official AFL Player Rating** is a rolling leaderboard value formed from those
  match performances over up to two seasons / 40 matches, with older performances
  down-weighted. It is not a single-match statistic. The current FAQ says the latest 20
  matches receive full weight and matches 21–40 taper to 5%; the older AFL methodology
  PDF says the latest 30 receive full weight and matches 31–40 taper to 10%. That
  first-party discrepancy is evidence that the rolling methodology has changed, or at
  minimum that its public specification is not stable enough to use without a version.

The repository's captured Official AFL schema includes a numeric field named
`ratingPoints` in each player-match response
(`src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:60-115`).
fitzRoy obtains it from a match endpoint and does not compute a rolling history. It is
therefore certainly a **per-match field rather than the rolling leaderboard value**.
It is a strong inference, but not yet a documented contract, that this field is exactly
the match score described in the AFL material: neither the reviewed fitzRoy source nor
a located first-party API schema defines the field by name. Gate 0B must confirm that
semantic mapping rather than silently treating the inference as fact.

## What the code proves

### Upstream, function, grain, and fields

Statly pins fitzRoy 1.7.0 and calls `fetch_player_stats_afl(season, round_number,
comp)` directly while preserving the returned object without filling or deriving values
(`etl/afl-trade-intelligence/capture_fitzroy.R:3-10,42-61,151-153`;
`etl/afl-trade-intelligence/renv.lock:628-637`).

The exact CRAN 1.7.0 source establishes the following:

1. `R/fetch-player-stats.R:78-142` resolves a fixture, maps over its match
   `providerId` values, fetches each match's player statistics, then joins fixture and
   team details. The result is player-by-match grain.
2. `R/helpers-afl.R:429-464` calls
   `https://api.afl.com.au/cfs/afl/playerStats/match/{providerId}`, splits home and away
   player arrays, strips JSON prefixes, and attaches the match `providerId`. It does not
   calculate or transform `ratingPoints`.
3. `R/fetch-fixture.R:71-123` obtains match IDs from the Official AFL fixture endpoint;
   `R/helpers-afl.R:284-312` discovers a competition-season ID from the Official AFL
   competition-seasons endpoint.
4. `R/helpers-general.R:9-18` validates only that a season is a numeric four-or-more
   digit value. It supplies no minimum supported year or historical-coverage guarantee.

Those references are to the official
[fitzRoy 1.7.0 CRAN source archive](https://cran.r-project.org/src/contrib/Archive/fitzRoy/fitzRoy_1.7.0.tar.gz).
Statly's capability declaration independently records Official AFL, direct function
`fetch_player_stats_afl`, match grain, provider-native player/match/club IDs, and no
documented minimum season
(`src/server/aflTradeIntelligence/source/fitzRoyProviderCapabilities.ts:54-86`). It
explicitly warns that technical capability is neither a rights grant nor completeness
proof.

The locally inspected 2026 field map identifies:

- match: `providerId`;
- player: `player.playerId`;
- club: `teamId`;
- context: round, date, status, home team, and away team.

See `src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:360-409`.
The natural key is match `providerId` plus `player.playerId`
(`src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:372-397`).
`ratingPoints` is present in the raw schema, but the current map promotes only goals as
a governed normalized metric
(`src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:398-406`).

### Null, zero, negative, failed-match, and correction behaviour

- **Negative:** allowed by the official scoring semantics. A signed value must not be
  rejected or clamped.
- **Zero:** potentially a genuine net-zero match contribution. It must not be interpreted
  as missing without first-party confirmation.
- **Null/missing:** fitzRoy supplies no special rule for `ratingPoints`; Statly must retain
  absence as absence and must not coerce it to zero.
- **Partial failure:** `R/fetch-player-stats.R:100-116` wraps every match fetch in
  `purrr::possibly(..., otherwise = data.frame())`. A failed match can therefore
  disappear from the bound result without proving that the season is complete. A row
  count alone is not a completeness check.
- **Correction:** `R/helpers-afl.R:446-455` explicitly removes
  `playerStats.lastUpdated`. The returned table therefore carries no upstream revision
  marker. The AFL has publicly documented Champion Data revising an official match stat
  after review in [this 2023 correction](https://www.afl.com.au/news/932300/no-moore-record-for-darcy-as-marks-tally-is-downgraded),
  which proves that official match data can change; it does not prove the frequency or
  republication policy for `ratingPoints`.

The bundled fitzRoy tests do not close these gaps. In 1.7.0,
`tests/testthat/test-fetch-player-stats.R:103-117` checks only that one AFL round from
2020 returns a tibble. It does not assert full-season match coverage, `ratingPoints`,
signed/null values, ID uniqueness, or correction stability.

## What remains unproven for 2021–2025

No reviewed primary source currently proves:

- that every concluded AFLM match in all five seasons is available from the current
  Official AFL fixture and player-stat endpoints;
- that every expected player appearance has a `ratingPoints` value, or what null means;
- that finals, postponed/cancelled matches, unusual rounds, substitutes, and renamed or
  transferred players are represented consistently;
- that player, club, and match IDs are stable and non-reused across all five seasons;
- that `ratingPoints` retained one definition, scale, precision, and correction policy;
- that replaying the endpoint returns the originally published value rather than a later
  corrected value;
- that a silent per-match fetch failure can be distinguished from a legitimately empty
  response without a fixture-to-response completeness ledger; or
- that Official AFL permits Statly to retain the historical payload and use the field as
  a target for model training.

The 2026 local authority cannot establish any of those historical claims: its declared
scope is 2026 only (`src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:192-227`).

## Rights and custody assessment

The AFL says the rating algorithm was developed by Champion Data, is complex and
proprietary, and may receive future tweaks
([Player Ratings FAQ](https://www.afl.com.au/news/453167/player-ratings-frequently-asked-questions)).
The AFL also says Champion Data's action data underlies the ratings
([Official Player Ratings launch](https://www.afl.com.au/news/453016/official-player-ratings-are-here)).
Those are attribution and methodology statements, not a reuse licence.

The AFL website's [Terms of Use](https://www.afl.com.au/terms-of-use) currently redirect
to Telstra terms which reserve owned or licensed site material and allow ordinary
viewing and expressly invited sharing, but otherwise restrict reproduction,
adaptation, distribution, publication, and use without a statutory basis or prior
written consent. The same terms say third-party supplier material is for personal use
and should not be stored except for the permitted use. It is legally uncertain whether
those generic redirected terms are the contract governing this API response, but they
do not provide affirmative evidence for Statly's proposed retention and model-training
use.

Champion Data's [Privacy Policy](https://www.championdata.com/privacy-policy/) says it
collects performance data and uses sports data to provide statistics services, maintain
databases, and conduct research. That explains Champion Data's own handling; it grants
no public downstream licence to Statly. No first-party public permission covering this
training use was established in this research.

The fitzRoy package's MIT licence covers fitzRoy code, not ownership or reuse rights in
the upstream AFL/Champion Data response. The repository's existing 2026 source-rights
record accordingly allows archive and derived-feature operations but explicitly blocks
`model_training` and public output, with a 30-day retention rule
(`src/server/aflTradeIntelligence/development/localOfficialAfl2026Authority.ts:177-189,228-264`).
That record also covers only 2026, not 2021–2025.

This is a source-governance finding, not legal advice. Gate 0A requires a reviewed grant
or legal basis that explicitly resolves endpoint access, raw and normalized retention,
derived aggregates, model targets and fitted artefacts, internal/commercial use,
attribution, correction/withdrawal, deletion, and publication.

## Target assessment

The admitted-player outcome contract is currently exact and closed: `games`, `goals`,
`brownlow_votes`, and `coaches_votes`, each represented as a non-negative integer string
(`src/server/aflTradeIntelligence/modeling/playerContributionContracts.ts:37-88,324-344`).
The candidate then applies a separately declared finite weight to each of those four
values (`src/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate.ts:62-75,230-239,354-372`).
The architecture describes that scalar as a named, governed transform with chronological
validation (`docs/architecture/afl-trade-intelligence.md:1221-1238`).

`ratingPoints` has attractive properties: it is match-grain, signed, and intended to
measure net action value rather than only participation, scoring, and awards. But it is
not an observed ground truth. It is the output of Champion Data's proprietary model.
Training Statly directly on it would partly distil an upstream model whose inputs,
weights, version changes, and role effects Statly cannot audit. It would also introduce
a signed decimal into a contract that deliberately accepts exactly four non-negative
integer metrics.

Therefore:

1. Do **not** silently substitute `ratingPoints` for the current scalar.
2. After rights and completeness gates pass, admit it first as a separately named,
   versioned shadow validation measure. Compare coverage, stability, role/era bias, and
   held-out agreement against the current target without tuning on `final_test`.
3. Consider it as the primary target only if that evaluation shows material improvement
   for the product decision and the source licence, method version, correction process,
   and long-term reproducibility are acceptable. Such promotion needs a new outcome
   schema/protocol version and a migration plan; it is not a configuration-only change.

## Go/no-go decision tree and next action

```text
Written, reviewed 2021–2025 authority covers retention + derived/model use?
├─ No  → NO-GO. Do not capture or use ratingPoints.
└─ Yes → Run a quarantined representative Gate 0B capture under that authority.
         │
         ├─ Fixture reconciliation, appearance coverage, identifiers, signed/null
         │  semantics, scale/version, and correction replay all pass?
         │  └─ No  → NO-GO. Record the failed gate; keep the existing target.
         │
         └─ Yes → Define a signed-decimal, source/version-aware outcome contract and
                  evaluate ratingPoints only as shadow validation.
                  │
                  ├─ No material, stable product-validity improvement?
                  │  └─ Keep it as validation or reject it.
                  └─ Material stable improvement + durable rights + reproducibility?
                     └─ Propose a separately reviewed primary-target protocol version.
```

The immediate next action for #574 is **not an API capture**. Obtain and record a
reviewed Gate 0A decision from the AFL/Champion Data rights holder (or counsel-approved
legal basis) for the exact uses above. Until then, keep the four-metric scalar as the
only admitted target and record Official AFL `ratingPoints` as a blocked candidate.
