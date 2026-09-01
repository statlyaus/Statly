#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const repositoryRootRealPath = realpathSync(repositoryRoot);
const ontologyPath = join(repositoryRoot, 'config/ontology/statly.ontology.json');
const schemaPath = join(repositoryRoot, 'config/ontology/statly.ontology.schema.json');

const errors = [];
const ontology = parseJson(ontologyPath, 'ontology');
const schema = parseJson(schemaPath, 'ontology schema');

if (ontology && schema) validateOntology(ontology, schema);

if (errors.length > 0) {
  console.error(`Ontology checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Ontology checks passed: ${ontology.nodes.length} nodes, ${ontology.symbolicStatements.length} symbolic statements, ${ontology.hypotheses.length} hypotheses, and ${ontology.lineages.length} lineages.`
  );
}

function parseJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateOntology(document, schemaDocument) {
  validateJsonSchema(document, schemaDocument, schemaDocument, '$');
  assert(
    document.$schema === './statly.ontology.schema.json',
    'ontology must reference its repository-local schema'
  );
  assert(
    schemaDocument.$schema === 'https://json-schema.org/draft/2020-12/schema',
    'ontology schema must use JSON Schema draft 2020-12'
  );
  assert(document.generated === false, 'ontology kernel must remain human-reviewed, not generated');
  assert(/^\d+\.\d+\.\d+$/.test(document.version ?? ''), 'ontology version must be semantic');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(document.lastVerified ?? ''), 'lastVerified must be a date');

  const collections = [
    ['nodes', document.nodes],
    ['evidence', document.evidence],
    ['symbolicStatements', document.symbolicStatements],
    ['hypotheses', document.hypotheses],
    ['lineages', document.lineages],
    ['protectedInvariants', document.protectedInvariants],
  ];

  for (const [name, value] of collections) {
    assert(Array.isArray(value), `${name} must be an array`);
  }
  if (collections.some(([, value]) => !Array.isArray(value))) return;

  const allTopLevelItems = collections.flatMap(([, value]) => value);
  const allIds = new Set();
  for (const item of allTopLevelItems) {
    assert(isNamespacedId(item.id), `invalid or missing namespaced ID: ${String(item.id)}`);
    if (allIds.has(item.id)) errors.push(`duplicate ontology ID: ${item.id}`);
    allIds.add(item.id);
  }

  const nodeIds = new Set(document.nodes.map(({ id }) => id));
  const evidenceIds = new Set(document.evidence.map(({ id }) => id));
  const statementIds = new Set(document.symbolicStatements.map(({ id }) => id));
  const hypothesisIds = new Set(document.hypotheses.map(({ id }) => id));
  const lineageIds = new Set(document.lineages.map(({ id }) => id));
  const relationTypes = new Set(document.relationTypes ?? []);

  validateNodes(document.nodes);
  validateEvidence(document.evidence);

  for (const statement of document.symbolicStatements) {
    validateTriple(statement, nodeIds, relationTypes);
    assert(
      ['asserted', 'observed', 'rejected'].includes(statement.epistemicState),
      `${statement.id}: symbolic statements cannot be inferred`
    );
    validateEvidenceReferences(statement.id, statement.evidence, evidenceIds, true);
  }

  for (const hypothesis of document.hypotheses) {
    validateTriple(hypothesis, nodeIds, relationTypes);
    assert(
      ['inferred', 'rejected'].includes(hypothesis.epistemicState),
      `${hypothesis.id}: hypothesis must be inferred or rejected`
    );
    assert(
      Number.isFinite(hypothesis.probability) &&
        hypothesis.probability >= 0 &&
        hypothesis.probability <= 1,
      `${hypothesis.id}: probability must be between 0 and 1`
    );
    validateCalibration(hypothesis);
    validateEvidenceReferences(
      hypothesis.id,
      [...hypothesis.supportingEvidence, ...hypothesis.contradictingEvidence],
      evidenceIds,
      false
    );
    assert(
      lineageIds.has(hypothesis.lineage),
      `${hypothesis.id}: missing lineage ${hypothesis.lineage}`
    );
    assert(
      hypothesis.epistemicState !== 'rejected' || hypothesis.status === 'retired',
      `${hypothesis.id}: rejected hypotheses must be retired`
    );
  }

  const lineageStepIds = new Set();
  for (const lineage of document.lineages) {
    assert(
      hypothesisIds.has(lineage.hypothesis),
      `${lineage.id}: missing hypothesis ${lineage.hypothesis}`
    );
    assert(
      Array.isArray(lineage.steps) && lineage.steps.length > 0,
      `${lineage.id}: lineage has no steps`
    );
    validateLineage(lineage, evidenceIds, hypothesisIds, lineageStepIds);
  }

  for (const hypothesis of document.hypotheses) {
    const lineage = document.lineages.find(({ id }) => id === hypothesis.lineage);
    assert(
      lineage?.hypothesis === hypothesis.id,
      `${hypothesis.id}: lineage does not point back to its hypothesis`
    );
    if (lineage) {
      const lineageInputs = new Set(lineage.steps.flatMap(({ inputs }) => inputs));
      for (const evidenceId of [
        ...hypothesis.supportingEvidence,
        ...hypothesis.contradictingEvidence,
      ]) {
        assert(
          lineageInputs.has(evidenceId),
          `${hypothesis.id}: lineage does not consume declared evidence ${evidenceId}`
        );
      }
    }
  }

  for (const invariant of document.protectedInvariants) {
    assert(
      statementIds.has(invariant.requiredStatement),
      `${invariant.id}: missing required statement ${invariant.requiredStatement}`
    );
  }

  validateProtectedInvariants(document);
}

function validateNodes(nodes) {
  const allowedKinds = new Set([
    'domain_concept',
    'module',
    'interface',
    'runtime_process',
    'store',
    'external_system',
    'repository_artifact',
    'local_capability',
  ]);
  for (const node of nodes) {
    assert(allowedKinds.has(node.kind), `${node.id}: unknown node kind ${node.kind}`);
    assert(nonEmpty(node.label), `${node.id}: node label is required`);
    assert(nonEmpty(node.description), `${node.id}: node description is required`);
  }
}

function validateEvidence(evidenceItems) {
  const repositoryEvidenceKinds = new Set([
    'canonical_document',
    'executable_schema',
    'configuration',
    'repository_observation',
  ]);
  for (const item of evidenceItems) {
    assert(nonEmpty(item.location), `${item.id}: evidence location is required`);
    assert(!item.location.startsWith('/'), `${item.id}: absolute paths are prohibited`);
    assert(
      !/(^|\/)\.env($|\.)/.test(item.location),
      `${item.id}: environment files are prohibited`
    );
    assert(
      item.location !== 'prisma/dev.db',
      `${item.id}: local development database is prohibited`
    );
    assert(
      !item.location.includes('..'),
      `${item.id}: evidence path must remain inside the repository`
    );
    assert(
      !/(^|\/)(node_modules|\.next|dist)(\/|$)/.test(item.location),
      `${item.id}: generated or dependency trees are prohibited evidence`
    );
    if (repositoryEvidenceKinds.has(item.kind)) {
      const evidencePath = resolve(repositoryRoot, item.location);
      assert(
        existsSync(evidencePath),
        `${item.id}: repository evidence location does not exist: ${item.location}`
      );
      if (existsSync(evidencePath)) {
        const relativeRealPath = relative(repositoryRootRealPath, realpathSync(evidencePath));
        assert(
          relativeRealPath !== '..' && !relativeRealPath.startsWith(`..${sep}`),
          `${item.id}: repository evidence location escapes the repository: ${item.location}`
        );
      }
    }
  }
}

function validateTriple(item, nodeIds, relationTypes) {
  assert(nodeIds.has(item.subject), `${item.id}: unknown subject ${item.subject}`);
  assert(relationTypes.has(item.predicate), `${item.id}: unknown predicate ${item.predicate}`);
  assert(nodeIds.has(item.object), `${item.id}: unknown object ${item.object}`);
}

function validateEvidenceReferences(ownerId, references, evidenceIds, requireEvidence) {
  assert(Array.isArray(references), `${ownerId}: evidence references must be an array`);
  if (!Array.isArray(references)) return;
  assert(
    !requireEvidence || references.length > 0,
    `${ownerId}: at least one evidence item is required`
  );
  assert(
    new Set(references).size === references.length,
    `${ownerId}: duplicate evidence reference`
  );
  for (const reference of references) {
    assert(evidenceIds.has(reference), `${ownerId}: unknown evidence ${reference}`);
  }
}

function validateCalibration(hypothesis) {
  const ranges = {
    low: [0, 0.5],
    medium: [0.5, 0.8],
    high: [0.8, 0.95],
    near_certain: [0.95, 1.0000001],
  };
  const range = ranges[hypothesis.calibration];
  assert(Boolean(range), `${hypothesis.id}: unknown calibration ${hypothesis.calibration}`);
  if (!range) return;
  assert(
    hypothesis.probability >= range[0] && hypothesis.probability < range[1],
    `${hypothesis.id}: probability does not match ${hypothesis.calibration} calibration`
  );
}

function validateLineage(lineage, evidenceIds, hypothesisIds, lineageStepIds) {
  const availableOutputs = new Set(evidenceIds);

  for (const step of lineage.steps) {
    assert(isNamespacedId(step.id), `${lineage.id}: invalid lineage step ID ${String(step.id)}`);
    assert(!lineageStepIds.has(step.id), `${lineage.id}: duplicate lineage step ID ${step.id}`);
    lineageStepIds.add(step.id);
    assert(nonEmpty(step.operation), `${step.id}: operation is required`);
    assert(Array.isArray(step.inputs) && step.inputs.length > 0, `${step.id}: inputs are required`);
    for (const input of step.inputs ?? []) {
      assert(
        availableOutputs.has(input),
        `${step.id}: input ${input} has no prior evidence or output`
      );
    }
    assert(nonEmpty(step.output), `${step.id}: output is required`);
    availableOutputs.add(step.output);
  }

  const finalOutput = lineage.steps.at(-1)?.output;
  assert(
    hypothesisIds.has(finalOutput) && finalOutput === lineage.hypothesis,
    `${lineage.id}: final step must output ${lineage.hypothesis}`
  );
}

function validateProtectedInvariants(document) {
  const requiredTriples = [
    [
      'statement:prisma_owns_protected_state',
      'module:prisma_domain_services',
      'owns',
      'concept:protected_fantasy_state',
      'asserted',
    ],
    [
      'statement:firestore_must_not_own_protected_state',
      'store:firestore',
      'must_not_own',
      'concept:protected_fantasy_state',
      'asserted',
    ],
    [
      'statement:redis_must_not_own_protected_state',
      'store:redis',
      'must_not_own',
      'concept:protected_fantasy_state',
      'asserted',
    ],
    [
      'statement:authorization_scoped_by_league',
      'concept:authorization',
      'scopes',
      'concept:league_scope',
      'asserted',
    ],
    [
      'statement:authorization_scoped_by_season',
      'concept:authorization',
      'scopes',
      'concept:season_scope',
      'asserted',
    ],
    [
      'statement:firebase_does_not_authorize',
      'external:firebase_auth',
      'does_not_authorize',
      'concept:authorization',
      'asserted',
    ],
    [
      'statement:socket_commands_depend_on_persisted_state',
      'interface:socket_commands',
      'depends_on',
      'module:prisma_domain_services',
      'asserted',
    ],
    [
      'statement:realtime_requires_reconnect_catch_up',
      'concept:realtime_delivery',
      'requires',
      'concept:reconnect_catch_up',
      'asserted',
    ],
    [
      'statement:etl_implements_fail_closed_ingestion',
      'module:etl_pipeline',
      'implements',
      'concept:fail_closed_ingestion',
      'asserted',
    ],
    [
      'statement:tests_require_disposable_db',
      'module:prisma_domain_services',
      'verified_by',
      'capability:disposable_test_database',
      'asserted',
    ],
    [
      'statement:tests_must_not_target_prisma_dev_db',
      'capability:disposable_test_database',
      'must_not_target',
      'store:prisma_dev_db',
      'asserted',
    ],
  ];

  for (const [id, subject, predicate, object, epistemicState] of requiredTriples) {
    const statement = document.symbolicStatements.find((candidate) => candidate.id === id);
    assert(Boolean(statement), `protected statement is missing: ${id}`);
    if (!statement) continue;
    assert(
      statement.subject === subject &&
        statement.predicate === predicate &&
        statement.object === object &&
        statement.epistemicState === epistemicState,
      `${id}: protected statement has changed meaning`
    );
  }
}

function validateJsonSchema(value, schemaNode, rootSchema, path) {
  if (schemaNode.$ref) {
    const reference = resolveSchemaReference(rootSchema, schemaNode.$ref);
    assert(Boolean(reference), `${path}: unresolved schema reference ${schemaNode.$ref}`);
    if (reference) validateJsonSchema(value, reference, rootSchema, path);
    return;
  }

  if (schemaNode.allOf) {
    for (const branch of schemaNode.allOf) validateJsonSchema(value, branch, rootSchema, path);
  }

  if (schemaNode.if && matchesJsonSchema(value, schemaNode.if, rootSchema)) {
    validateJsonSchema(value, schemaNode.then ?? {}, rootSchema, path);
  }

  if (schemaNode.not && matchesJsonSchema(value, schemaNode.not, rootSchema)) {
    errors.push(`${path}: value matches a prohibited schema`);
  }

  if (schemaNode.enum && !schemaNode.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path}: value is not one of the allowed schema values`);
  }
  if ('const' in schemaNode && !Object.is(schemaNode.const, value)) {
    errors.push(`${path}: value does not match the schema constant`);
  }

  if (schemaNode.type && !hasJsonType(value, schemaNode.type)) {
    errors.push(`${path}: expected ${schemaNode.type}`);
    return;
  }

  if (typeof value === 'string') {
    if (schemaNode.minLength !== undefined && value.length < schemaNode.minLength) {
      errors.push(`${path}: string is shorter than ${schemaNode.minLength}`);
    }
    if (schemaNode.pattern && !new RegExp(schemaNode.pattern).test(value)) {
      errors.push(`${path}: string does not match ${schemaNode.pattern}`);
    }
    if (schemaNode.format === 'date' && !isIsoDate(value)) {
      errors.push(`${path}: string is not a valid ISO date`);
    }
  }

  if (typeof value === 'number') {
    if (schemaNode.minimum !== undefined && value < schemaNode.minimum) {
      errors.push(`${path}: number is below ${schemaNode.minimum}`);
    }
    if (schemaNode.maximum !== undefined && value > schemaNode.maximum) {
      errors.push(`${path}: number is above ${schemaNode.maximum}`);
    }
    if (schemaNode.exclusiveMinimum !== undefined && value <= schemaNode.exclusiveMinimum) {
      errors.push(`${path}: number must be greater than ${schemaNode.exclusiveMinimum}`);
    }
    if (schemaNode.exclusiveMaximum !== undefined && value >= schemaNode.exclusiveMaximum) {
      errors.push(`${path}: number must be less than ${schemaNode.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schemaNode.minItems !== undefined && value.length < schemaNode.minItems) {
      errors.push(`${path}: array has fewer than ${schemaNode.minItems} items`);
    }
    if (schemaNode.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length)
        errors.push(`${path}: array items are not unique`);
    }
    if (schemaNode.items) {
      value.forEach((item, index) =>
        validateJsonSchema(item, schemaNode.items, rootSchema, `${path}[${index}]`)
      );
    }
  }

  if (isPlainObject(value)) {
    const properties = schemaNode.properties ?? {};
    for (const requiredProperty of schemaNode.required ?? []) {
      if (!(requiredProperty in value))
        errors.push(`${path}: missing required property ${requiredProperty}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        validateJsonSchema(child, properties[key], rootSchema, `${path}.${key}`);
      } else if (schemaNode.additionalProperties === false) {
        errors.push(`${path}: unexpected property ${key}`);
      } else if (isPlainObject(schemaNode.additionalProperties)) {
        validateJsonSchema(child, schemaNode.additionalProperties, rootSchema, `${path}.${key}`);
      }
    }
    if (
      schemaNode.minProperties !== undefined &&
      Object.keys(value).length < schemaNode.minProperties
    ) {
      errors.push(`${path}: object has fewer than ${schemaNode.minProperties} properties`);
    }
  }

  if (schemaNode.anyOf) {
    const validBranches = schemaNode.anyOf.filter((branch) =>
      matchesJsonSchema(value, branch, rootSchema)
    );
    if (validBranches.length === 0) errors.push(`${path}: value does not match any allowed schema`);
  }
}

function matchesJsonSchema(value, schemaNode, rootSchema) {
  const previousErrors = errors.length;
  validateJsonSchema(value, schemaNode, rootSchema, '$probe');
  const matches = errors.length === previousErrors;
  errors.length = previousErrors;
  return matches;
}

function resolveSchemaReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) return null;
  return reference
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, segment) => current?.[segment], rootSchema);
}

function hasJsonType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
}

function isNamespacedId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}
