import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createAflTradeByteArtifactRef } from '../src/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from '../src/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';

/**
 * Prepares the narrow source-rights and Gate **proposals** for the Draftguru trade capabilities.
 *
 * It writes proposals only. The decision is the accountable owner's to record through the Gate ledger,
 * so this script never sets `decidedBy` and never emits a decision record.
 *
 * Usage: npx tsx Scripts/prepare-draftguru-trade-authority-proposals.ts <source-package-dir> [out.json]
 */
const sourcePackage = resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) {
  throw new TypeError('Pass the source-package directory as the first argument.');
}

/** The four reviewed documents, whose bytes are the rights evidence these proposals cite. */
const evidenceDocuments = {
  productOwnerAuthorization: '01-authorization-record.md',
  boundedCapturePlan: '02-bounded-capture-plan.md',
  publicAccessReview: '03-public-access-review.md',
  fieldBoundaryReview: '04-field-boundary-review.md',
} as const;

const evidence = Object.entries(evidenceDocuments).map(([role, path]) => {
  const absolute = join(sourcePackage, path);
  const bytes = readFileSync(absolute);
  if (bytes.length === 0) throw new TypeError(`Evidence document ${path} is empty.`);
  const reference = createAflTradeByteArtifactRef(
    bytes,
    'text/markdown',
    statSync(absolute).mtime.toISOString()
  );
  return { role, path, reference, recordedAt: statSync(absolute).mtime };
});
// Identical bytes collapse to one artifact id, so one document would silently stand for two roles.
if (new Set(evidence.map(({ reference }) => reference.artifactId)).size !== evidence.length) {
  throw new TypeError('Each evidence role requires a distinct document.');
}

const evidenceById = Object.fromEntries(
  evidence.map(({ role, reference }) => [role, reference.artifactId])
) as Record<keyof typeof evidenceDocuments, string>;

// The cohort-relevant trade seasons measured from the archive, inside the owner's 2000-2025 decision.
const seasons = [
  2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
];
const latestEvidenceAt = Math.max(...evidence.map(({ recordedAt }) => recordedAt.getTime()));
const timing = {
  termsEffectiveAt: '2026-09-10T00:00:00.000Z',
  termsExpireAt: '2027-09-09T00:00:00.000Z',
  // Anchored to the evidence, not the clock, so re-preparing unchanged evidence reproduces the same ids.
  rightsProposedAt: new Date(latestEvidenceAt).toISOString(),
  proposalProposedAt: new Date(latestEvidenceAt + 1000).toISOString(),
};

const prepared = (
  ['draftguru-trade-index', 'draftguru-trade-detail'] as DraftguruTradeCapability[]
).map((capabilityId) => ({
  capabilityId,
  ...createDraftguruTradeAuthorityProposal({
    capabilityId,
    seasons,
    evidenceIds: evidenceById,
    timing,
  }),
}));

const packet = {
  schemaVersion: 'statly-draftguru-trade-authority-proposal-packet/v1',
  preparedAt: new Date().toISOString(),
  preparedBy: 'statly-agent-assisted',
  status: 'proposed_awaiting_accountable_owner_decision',
  scope: { capabilityIds: prepared.map(({ capabilityId }) => capabilityId), seasons },
  decisionOwner: 'statly-product-owner',
  /** What a reviewer must confirm, and what this record deliberately does not authorize. */
  review: {
    excludes: [
      'Model training, predictive features and forecasting.',
      'Public fact display, public derived output, raw redistribution, publication and fantasy use.',
      'Production activation.',
    ],
    unresolvedBeforeDecision: [
      'Original 2026-09-10 decision reference and its current ledger selection.',
      'Exact URL and field allowlists per season, beyond the reviewed field-boundary candidate set.',
      'The separately evidenced trade dates the field review requires; this source records none.',
      'Whether this decision supersedes the broader issue-579 Draftguru decision, which otherwise stays effective.',
    ],
    capture:
      'Capture with createDraftguruTradeCaptureCommand, which requests only the permitted operations and archive field uses.',
  },
  evidence: evidence.map(({ role, path, reference }) => ({ role, path, reference })),
  proposals: prepared.map(({ capabilityId, sourceRights, proposal }) => ({
    capabilityId,
    sourceRights,
    proposal,
  })),
};

const serialized = `${JSON.stringify(packet, null, 2)}\n`;
if (process.argv[3] !== undefined) {
  writeFileSync(resolve(process.argv[3]), serialized);
}
process.stdout.write(
  `${JSON.stringify(
    {
      status: packet.status,
      seasons: `${seasons[0]}-${seasons.at(-1)}`,
      capabilities: prepared.map(({ capabilityId, sourceRights, proposal }) => ({
        capabilityId,
        rightsArtifactId: sourceRights.rightsArtifactId,
        proposalId: proposal.proposalId,
        decisionKey: proposal.content.decisionKey,
        operations: proposal.content.scope.dimensions.find(({ name }) => name === 'operation')
          ?.values,
        fields: sourceRights.content.fields.length,
      })),
      wroteTo: process.argv[3] ?? null,
    },
    null,
    1
  )}\n`
);
