import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

// Synthetic provider identity-assignment chains in every continuity state, shared by the
// assignment continuity suites (migrations 0242 and 0290).
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const caseId = (key: string) => `provider-identity-assignment-case:${sha256(key)}`;
export const decision = (key: string, index: number) => `continuity:${key}:${index}`;
const subject = (key: string, index: number) => `provider_resolution_case:${key}:${index}`;

// Scale measurement: every row's resolution shares one of a few long club chains, as every club
// occurrence of a genuine season shares its club's identity-assignment chain.
// ponytail: one transaction holds SCALE_CASES * SCALE_CHAIN advisory locks. At 20 cases (12,000
// locks) a default PostgreSQL 16 lock table ran out of shared memory once a parallel file also
// held locks; raise only with max_locks_per_transaction on the CI service containers.
export const SCALE_CASES = 5;
export const SCALE_CHAIN = 600;
export const SCALE_ROWS_PER_CASE = 100;

interface Link {
  revision: number | null;
  table?: 'club' | 'player';
  target?: string | null;
  kind?: string;
  status?: string;
  outcome?: string;
  review?: 'approved' | 'rejected' | null;
  /** Index of the link whose assignment decision this link supersedes; default the previous. */
  supersedes?: number | null;
  /** Index of the link whose review decision this link's review supersedes (a confirmation). */
  confirms?: number;
}

export interface Chain {
  key: string;
  links: Link[];
  head?: { revision?: number; decisionIndex?: number; status?: string; kind?: string } | null;
  /** Review decisions outside the chain that supersede a link's review. */
  successors?: { of: number; decision: 'approved' | 'withdrawn' }[];
}

export const linear = (count: number, override: (revision: number) => Partial<Link> = () => ({})) =>
  Array.from({ length: count }, (_, index) => ({ revision: index + 1, ...override(index + 1) }));

export const CHAINS: Chain[] = [
  { key: 'current', links: linear(10) },
  { key: 'superseded', links: linear(8), successors: [{ of: 3, decision: 'approved' }] },
  { key: 'confirmed', links: linear(8, (revision) => (revision === 6 ? { confirms: 2 } : {})) },
  { key: 'withdrawn', links: linear(8), successors: [{ of: 4, decision: 'withdrawn' }] },
  {
    key: 'rejected',
    links: linear(6, (revision) => (revision === 3 ? { review: 'rejected' } : {})),
  },
  { key: 'unreviewed', links: linear(6, (revision) => (revision === 4 ? { review: null } : {})) },
  { key: 'retarget', links: linear(6, (revision) => (revision === 3 ? { target: 'club:b' } : {})) },
  {
    key: 'inactive-link',
    links: linear(5, (revision) => (revision === 2 ? { status: 'inactive' } : {})),
  },
  {
    key: 'declined-link',
    links: linear(5, (revision) => (revision === 4 ? { outcome: 'rejected' } : {})),
  },
  { key: 'null-target', links: linear(5, (revision) => (revision === 2 ? { target: null } : {})) },
  { key: 'gap', links: [1, 2, 3, 5, 6].map((revision) => ({ revision })) },
  {
    key: 'duplicate',
    links: [...linear(6), { revision: 3, table: 'player', supersedes: 1 }],
    head: { decisionIndex: 5 },
  },
  { key: 'broken-link', links: linear(6, (revision) => (revision === 4 ? { supersedes: 0 } : {})) },
  { key: 'inactive-head', links: linear(4), head: { status: 'inactive' } },
  { key: 'moved-head', links: linear(6), head: { decisionIndex: 4 } },
  { key: 'behind-head', links: linear(6), head: { revision: 4, decisionIndex: 3 } },
  { key: 'kind-mismatch', links: linear(4), head: { kind: 'club_alias' } },
  { key: 'no-head', links: linear(4), head: null },
  {
    key: 'null-revision',
    links: [...linear(3), { revision: null, supersedes: null }],
    head: { decisionIndex: 2 },
  },
  { key: 'player-chain', links: linear(7, () => ({ table: 'player', kind: 'player' })) },
  // Review subjects and the head of these two chains are held by another session.
  { key: 'locked', links: linear(10) },
  { key: 'head-locked', links: linear(5) },
];
export const LOCKED_SUBJECT = subject('locked', 5); // revision 6

export async function inReplicaTransaction(
  pool: Pool,
  work: (client: PoolClient) => Promise<void>
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Chains are seeded directly, in states the reviewed writers refuse to create; the
    // resolution and assignment writers are covered by their own suites.
    await client.query(`SET LOCAL session_replication_role='replica'`);
    await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface SeededReview {
  decisionId: string;
  subjectId: string;
  decision: string;
  supersedes: string | null;
}

async function seedChain(client: PoolClient, chain: Chain) {
  const reviews: SeededReview[] = chain.links.flatMap((link, index) =>
    link.review === null
      ? []
      : [
          {
            decisionId: decision(chain.key, index),
            subjectId: `${chain.key}:${index}`,
            decision: link.review ?? 'approved',
            supersedes: link.confirms === undefined ? null : decision(chain.key, link.confirms),
          },
        ]
  );
  for (const [index, successor] of (chain.successors ?? []).entries())
    reviews.push({
      decisionId: `continuity-successor:${chain.key}:${index}`,
      subjectId: `${chain.key}:${successor.of}`,
      decision: successor.decision,
      supersedes: decision(chain.key, successor.of),
    });
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,
       supersedes_decision_id)
     SELECT review."decisionId",'provider_resolution_case',review."subjectId",review.decision,
       'Synthetic continuity state','{}'::jsonb,'synthetic-reviewer','2026-07-01T00:00:00.000Z',
       review.supersedes
       FROM jsonb_to_recordset($1::jsonb) AS review("decisionId" text,"subjectId" text,
         decision text,supersedes text)`,
    [JSON.stringify(reviews)]
  );
  const rows = chain.links.map((link, index) => ({
    decisionId: decision(chain.key, index),
    table: link.table ?? 'club',
    revision: link.revision,
    target: link.target === undefined ? 'club:a' : link.target,
    kind: link.kind ?? 'club',
    status: link.status ?? 'active',
    outcome: link.outcome ?? 'approved',
    supersedes:
      link.supersedes === null
        ? null
        : link.supersedes !== undefined
          ? decision(chain.key, link.supersedes)
          : index === 0
            ? null
            : decision(chain.key, index - 1),
  }));
  const common = `(resolution_id,resolution_case_id,revision,outcome,assignment_case_id,
       assignment_entity_kind,assignment_identity_id,assignment_revision,
       supersedes_assignment_decision_id,assignment_status,decision_id,proposal_id,
       resolution_sha256,decided_at,effective_at,decision_json`;
  const values = `row."decisionId",'resolution-case:'||row."decisionId",1,row.outcome,$2,row.kind,
       'identity:'||$3,row.revision,row.supersedes,row.status,row."decisionId",
       'proposal:'||row."decisionId",encode(sha256(convert_to(row."decisionId",'UTF8')),'hex'),
       '2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z','{}'::jsonb`;
  const recordset = `jsonb_to_recordset($1::jsonb) AS row("decisionId" text,"table" text,
       revision integer,target text,kind text,status text,outcome text,supersedes text)`;
  await client.query(
    `INSERT INTO outcome_provider_club_resolution ${common},occurrence_source,club_identity_id,club_id)
     SELECT ${values},'synthetic','identity:'||$3,row.target FROM ${recordset} WHERE row."table"='club'`,
    [JSON.stringify(rows), caseId(chain.key), chain.key]
  );
  await client.query(
    `INSERT INTO outcome_provider_player_resolution ${common},identity_candidate_id,player_identity_id,player_id)
     SELECT ${values},'candidate:'||row."decisionId",'identity:'||$3,row.target
       FROM ${recordset} WHERE row."table"='player'`,
    [JSON.stringify(rows), caseId(chain.key), chain.key]
  );
  if (chain.head === null) return;
  const revisions = chain.links.flatMap((link) => (link.revision === null ? [] : [link.revision]));
  const headIndex = chain.head?.decisionIndex ?? chain.links.length - 1;
  await client.query(
    `INSERT INTO outcome_provider_identity_assignment_head
      (assignment_case_id,entity_kind,identity_id,revision,decision_id,status,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-07-01T00:00:00.000Z')`,
    [
      caseId(chain.key),
      chain.head?.kind ?? chain.links[0]?.kind ?? 'club',
      `identity:${chain.key}`,
      chain.head?.revision ?? Math.max(...revisions),
      decision(chain.key, headIndex),
      chain.head?.status ?? 'active',
    ]
  );
}

/** Long same-target club chains: SCALE_CASES cases of SCALE_CHAIN revisions each. */
async function seedScaleChains(client: PoolClient) {
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     SELECT 'scale:'||c||':'||r,'provider_resolution_case','scale:'||c||':'||r,'approved',
       'Synthetic same-target confirmation','{}'::jsonb,'synthetic-reviewer','2026-07-01T00:00:00.000Z'
       FROM generate_series(1,$1::integer) c CROSS JOIN generate_series(1,$2::integer) r`,
    [SCALE_CASES, SCALE_CHAIN]
  );
  await client.query(
    `INSERT INTO outcome_provider_club_resolution
      (resolution_id,resolution_case_id,occurrence_source,revision,outcome,assignment_case_id,
       assignment_entity_kind,assignment_identity_id,assignment_revision,
       supersedes_assignment_decision_id,assignment_status,club_identity_id,club_id,decision_id,
       proposal_id,resolution_sha256,decided_at,effective_at,decision_json)
     SELECT 'scale:'||c||':'||r,'scale-case:'||c||':'||r,'synthetic',1,'approved',
       'provider-identity-assignment-case:'||encode(sha256(convert_to('scale:'||c,'UTF8')),'hex'),
       'club','identity:scale:'||c,r,CASE WHEN r=1 THEN NULL ELSE 'scale:'||c||':'||(r-1) END,
       'active','identity:scale:'||c,'club:scale:'||c,'scale:'||c||':'||r,'proposal:scale:'||c||':'||r,
       encode(sha256(convert_to('scale:'||c||':'||r,'UTF8')),'hex'),'2026-07-01T00:00:00.000Z',
       '2026-07-01T00:00:00.000Z','{}'::jsonb
       FROM generate_series(1,$1::integer) c CROSS JOIN generate_series(1,$2::integer) r`,
    [SCALE_CASES, SCALE_CHAIN]
  );
  await client.query(
    `INSERT INTO outcome_provider_identity_assignment_head
      (assignment_case_id,entity_kind,identity_id,revision,decision_id,status,updated_at)
     SELECT 'provider-identity-assignment-case:'||encode(sha256(convert_to('scale:'||c,'UTF8')),'hex'),
       'club','identity:scale:'||c,$2::integer,'scale:'||c||':'||$2::integer,'active',
       '2026-07-01T00:00:00.000Z' FROM generate_series(1,$1::integer) c`,
    [SCALE_CASES, SCALE_CHAIN]
  );
}

/** Every chain state, one decision recorded in two resolution tables, and the scale chains. */
export async function seedAssignmentContinuityChains(pool: Pool) {
  await inReplicaTransaction(pool, async (client) => {
    for (const chain of CHAINS) await seedChain(client, chain);
    // One decision recorded in two resolution tables, delegated to the per-origin function.
    await seedChain(client, { key: 'twice', links: linear(1) });
    await client.query(
      `INSERT INTO outcome_provider_player_resolution
        (resolution_id,resolution_case_id,revision,outcome,assignment_case_id,assignment_entity_kind,
         assignment_identity_id,assignment_revision,assignment_status,decision_id,proposal_id,
         resolution_sha256,decided_at,effective_at,decision_json,identity_candidate_id,player_id)
       VALUES ('twice',$2,1,'approved',$1,'club','identity:twice',1,'active',$3,'proposal:twice',
         repeat('0',64),'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z','{}'::jsonb,
         'candidate:twice','club:a')`,
      [caseId('twice'), 'resolution-case:twice', decision('twice', 0)]
    );
    await seedScaleChains(client);
  });
}
