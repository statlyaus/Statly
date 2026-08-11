export type AflTradeNonproductionPlanIssueCode =
  | 'PLAN_SHAPE_INVALID'
  | 'CONFIGURATION_ATTESTATION_INVALID'
  | 'AUTHORITY_ENVIRONMENT_INVALID'
  | 'DATABASE_MISSING'
  | 'DATABASE_PUBLIC'
  | 'DATABASE_UNENCRYPTED'
  | 'DATABASE_KMS_MISSING'
  | 'DATABASE_BACKUPS_DISABLED'
  | 'DATABASE_DELETION_UNPROTECTED'
  | 'CACHE_MISSING'
  | 'CACHE_AT_REST_UNENCRYPTED'
  | 'CACHE_TRANSIT_UNENCRYPTED'
  | 'CUSTODY_BUCKET_MISSING'
  | 'CUSTODY_PUBLIC_ACCESS_BLOCK_MISSING'
  | 'CUSTODY_PUBLIC_ACCESS_UNBLOCKED'
  | 'CUSTODY_ENCRYPTION_MISSING'
  | 'CUSTODY_VERSIONING_MISSING'
  | 'CUSTODY_VERSIONING_DISABLED'
  | 'CUSTODY_RETENTION_MISSING'
  | 'CUSTODY_RETENTION_INVALID'
  | 'CUSTODY_SAFETY_POLICY_MISSING'
  | 'CUSTODY_SAFETY_POLICY_INVALID'
  | 'CAPTURE_IAM_POLICY_MISSING'
  | 'CAPTURE_IAM_POLICY_INVALID'
  | 'CAPTURE_IAM_WILDCARD_ACTION'
  | 'CAPTURE_IAM_WILDCARD_RESOURCE'
  | 'CAPTURE_IAM_ACTION_NOT_ALLOWED'
  | 'CAPTURE_IAM_RESOURCE_NOT_ALLOWED'
  | 'CAPTURE_KMS_POLICY_MISSING'
  | 'CAPTURE_KMS_POLICY_INVALID'
  | 'CAPTURE_KMS_ACTION_NOT_ALLOWED'
  | 'CAPTURE_KMS_RESOURCE_NOT_ALLOWED'
  | 'RUNTIME_DATABASE_SECRET_MISSING'
  | 'TASK_EXECUTION_POLICY_MISSING'
  | 'MIGRATION_POLICY_MISSING'
  | 'DATABASE_SECRET_POLICY_INVALID'
  | 'DATABASE_SECRET_ROLES_NOT_SEPARATED'
  | 'IAM_GRAPH_INVALID'
  | 'ROLE_TRUST_INVALID'
  | 'FOUNDATION_GRAPH_INVALID'
  | 'LOGGING_SAFETY_POLICY_INVALID'
  | 'NETWORK_BOUNDARY_INVALID'
  | 'WORKER_INTERNET_EGRESS_OPEN'
  | 'UNAPPROVED_COMPUTE'
  | 'CAPTURE_SCHEDULE_MISSING'
  | 'CAPTURE_SCHEDULE_ENABLED'
  | 'DISPATCH_FAILURE_ALARM_MISSING';

export interface AflTradeNonproductionPlanIssue {
  readonly code: AflTradeNonproductionPlanIssueCode;
  readonly address?: string;
  readonly message: string;
}

export interface AflTradeNonproductionPlanValidationOptions {
  readonly configurationSourceDigest: string;
}

interface PlanResourceChange {
  readonly address: string;
  readonly type: string;
  readonly actions: readonly string[];
  readonly after: Readonly<Record<string, unknown>>;
  readonly afterUnknown: Readonly<Record<string, unknown>>;
}

interface PlanConfigurationResource {
  readonly address: string;
  readonly type: string;
  readonly expressions: Readonly<Record<string, unknown>>;
}

function issue(
  code: AflTradeNonproductionPlanIssueCode,
  message: string,
  address?: string
): AflTradeNonproductionPlanIssue {
  return address === undefined ? { code, message } : { code, address, message };
}

function parseResourceChanges(plan: unknown): readonly PlanResourceChange[] | null {
  if (typeof plan !== 'object' || plan === null || !('resource_changes' in plan)) return null;
  const rawChanges = (plan as { resource_changes?: unknown }).resource_changes;
  if (!Array.isArray(rawChanges)) return null;

  const changes: PlanResourceChange[] = [];
  for (const rawChange of rawChanges) {
    if (typeof rawChange !== 'object' || rawChange === null) return null;
    const candidate = rawChange as {
      address?: unknown;
      type?: unknown;
      change?: { actions?: unknown; after?: unknown; after_unknown?: unknown };
    };
    const actions = candidate.change?.actions;
    if (
      typeof candidate.address !== 'string' ||
      typeof candidate.type !== 'string' ||
      !Array.isArray(actions) ||
      actions.length !== 1 ||
      typeof actions[0] !== 'string' ||
      !['create', 'no-op', 'read', 'update'].includes(actions[0]) ||
      typeof candidate.change?.after !== 'object' ||
      candidate.change.after === null
    ) {
      return null;
    }
    changes.push({
      address: candidate.address,
      type: candidate.type,
      actions: [actions[0]],
      after: candidate.change.after as Readonly<Record<string, unknown>>,
      afterUnknown:
        typeof candidate.change.after_unknown === 'object' &&
        candidate.change.after_unknown !== null
          ? (candidate.change.after_unknown as Readonly<Record<string, unknown>>)
          : {},
    });
  }
  return changes;
}

function parseConfigurationResources(plan: unknown): readonly PlanConfigurationResource[] {
  if (typeof plan !== 'object' || plan === null || !('configuration' in plan)) return [];
  const configuration = (plan as { configuration?: unknown }).configuration;
  if (typeof configuration !== 'object' || configuration === null) return [];
  const rootModule = (configuration as { root_module?: unknown }).root_module;
  if (typeof rootModule !== 'object' || rootModule === null) return [];
  const rawResources = (rootModule as { resources?: unknown }).resources;
  if (!Array.isArray(rawResources)) return [];

  return rawResources.flatMap((rawResource): readonly PlanConfigurationResource[] => {
    if (typeof rawResource !== 'object' || rawResource === null) return [];
    const candidate = rawResource as {
      address?: unknown;
      type?: unknown;
      expressions?: unknown;
    };
    if (
      typeof candidate.address !== 'string' ||
      typeof candidate.type !== 'string' ||
      typeof candidate.expressions !== 'object' ||
      candidate.expressions === null
    ) {
      return [];
    }
    return [
      {
        address: candidate.address,
        type: candidate.type,
        expressions: candidate.expressions as Readonly<Record<string, unknown>>,
      },
    ];
  });
}

function planVariable(plan: unknown, name: string): unknown {
  if (typeof plan !== 'object' || plan === null) return undefined;
  const variables = (plan as { variables?: unknown }).variables;
  if (typeof variables !== 'object' || variables === null) return undefined;
  const entry = (variables as Readonly<Record<string, unknown>>)[name];
  if (typeof entry !== 'object' || entry === null) return undefined;
  return (entry as { value?: unknown }).value;
}

function findByAddress(
  changes: readonly PlanResourceChange[],
  address: string
): PlanResourceChange | undefined {
  return changes.find((change) => change.address === address);
}

function findByCanonicalAddress(
  changes: readonly PlanResourceChange[],
  address: string
): PlanResourceChange | undefined {
  return changes.find((change) => canonicalAddress(change.address) === address);
}

function findConfigurationByAddress(
  resources: readonly PlanConfigurationResource[],
  address: string
): PlanConfigurationResource | undefined {
  return resources.find((resource) => resource.address === address);
}

function collectReferences(value: unknown, references: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
    return references;
  }
  if (typeof value !== 'object' || value === null) return references;
  const record = value as Readonly<Record<string, unknown>>;
  if (Array.isArray(record.references)) {
    for (const reference of record.references) {
      if (typeof reference === 'string') references.add(reference);
    }
  }
  for (const nested of Object.values(record)) collectReferences(nested, references);
  return references;
}

function specificReferences(value: unknown): readonly string[] {
  const references = [...collectReferences(value)];
  return references.filter(
    (candidate) =>
      !references.some(
        (other) =>
          other !== candidate &&
          (other.startsWith(`${candidate}.`) || other.startsWith(`${candidate}[`))
      )
  );
}

function constantStringValues(expression: unknown): readonly string[] {
  if (typeof expression !== 'object' || expression === null) return [];
  return stringValues((expression as { constant_value?: unknown }).constant_value);
}

function constantString(expression: unknown): string | null {
  if (typeof expression !== 'object' || expression === null) return null;
  const value = (expression as { constant_value?: unknown }).constant_value;
  return typeof value === 'string' ? value : null;
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value) => expected.includes(value)) &&
    expected.every((value) => actual.includes(value))
  );
}

function exactRenderedStringSet(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string') &&
    exactStringSet(value, expected)
  );
}

interface ExpectedConfigurationStatement {
  readonly actions: readonly string[];
  readonly resourceReferences: readonly string[];
}

function configurationPolicyMatches(
  resources: readonly PlanConfigurationResource[],
  policyAddress: string,
  documentAddress: string,
  expectedStatements: readonly ExpectedConfigurationStatement[],
  allowUnrelatedStatements = false,
  isRelevantAction?: (action: string) => boolean
): boolean {
  const policy = findConfigurationByAddress(resources, policyAddress);
  const document = findConfigurationByAddress(resources, documentAddress);
  if (policy === undefined || document === undefined) return false;
  if (!exactStringSet(specificReferences(policy.expressions.policy), [`${documentAddress}.json`])) {
    return false;
  }

  const rawStatements = document.expressions.statement;
  if (!Array.isArray(rawStatements)) return false;
  const relevantActions = new Set(expectedStatements.flatMap(({ actions }) => actions));
  const actionIsRelevant =
    isRelevantAction ?? ((action: string) => relevantActions.has(action) || action === '*');
  const actualStatements = rawStatements.flatMap((rawStatement) => {
    if (typeof rawStatement !== 'object' || rawStatement === null) return [];
    const statement = rawStatement as Readonly<Record<string, unknown>>;
    const actions = constantStringValues(statement.actions);
    if (allowUnrelatedStatements && !actions.some(actionIsRelevant)) {
      return [];
    }
    if (constantString(statement.effect) !== 'Allow') return [{ invalid: true } as const];
    return [
      {
        actions,
        resourceReferences: specificReferences(statement.resources),
      },
    ];
  });
  if (actualStatements.some((statement) => 'invalid' in statement)) return false;
  if (actualStatements.length !== expectedStatements.length) return false;

  return expectedStatements.every((expected) =>
    actualStatements.some(
      (actual) =>
        !('invalid' in actual) &&
        exactStringSet(actual.actions, expected.actions) &&
        exactStringSet(actual.resourceReferences, expected.resourceReferences)
    )
  );
}

function isSecretsManagerAction(action: string): boolean {
  return action === '*' || action.toLowerCase().startsWith('secretsmanager:');
}

function configurationPolicyActions(
  resources: readonly PlanConfigurationResource[],
  documentAddress: string
): readonly string[] | null {
  const document = findConfigurationByAddress(resources, documentAddress);
  const rawStatements = document?.expressions.statement;
  if (!Array.isArray(rawStatements)) return null;
  return rawStatements.flatMap((rawStatement) => {
    if (typeof rawStatement !== 'object' || rawStatement === null) return [];
    return constantStringValues((rawStatement as Readonly<Record<string, unknown>>).actions);
  });
}

function configurationPolicyStatementSids(
  resources: readonly PlanConfigurationResource[],
  documentAddress: string
): readonly string[] | null {
  const document = findConfigurationByAddress(resources, documentAddress);
  const rawStatements = document?.expressions.statement;
  if (!Array.isArray(rawStatements)) return null;
  const sids = rawStatements.map((rawStatement) => {
    if (typeof rawStatement !== 'object' || rawStatement === null) return null;
    return constantString((rawStatement as Readonly<Record<string, unknown>>).sid);
  });
  return sids.every((sid): sid is string => sid !== null) ? sids : null;
}

function configurationExpressionReferences(
  resources: readonly PlanConfigurationResource[],
  address: string,
  expression: string,
  expectedReference: string
): boolean {
  const resource = findConfigurationByAddress(resources, address);
  return (
    resource !== undefined &&
    exactStringSet(specificReferences(resource.expressions[expression]), [expectedReference])
  );
}

function plannedStringMatchesExactResource(
  change: PlanResourceChange | undefined,
  configurationResources: readonly PlanConfigurationResource[],
  property: string,
  expectedValue: string | null,
  expectedReference: string
): boolean {
  if (change === undefined || expectedValue === null) return false;
  const value = change.after[property];
  if (typeof value === 'string') return value === expectedValue;
  return (
    hasUnknownProperty(change.afterUnknown, property) &&
    configurationExpressionReferences(
      configurationResources,
      change.address,
      property,
      expectedReference
    )
  );
}

function plannedStringSetMatchesExactResources(
  change: PlanResourceChange | undefined,
  configurationResources: readonly PlanConfigurationResource[],
  property: string,
  expectedValues: readonly string[],
  expectedReferences: readonly string[]
): boolean {
  if (change === undefined) return false;
  const value = change.after[property];
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return exactStringSet(value, expectedValues);
  }
  const configuration = findConfigurationByAddress(configurationResources, change.address);
  return (
    hasUnknownProperty(change.afterUnknown, property) &&
    configuration !== undefined &&
    exactStringSet(specificReferences(configuration.expressions[property]), expectedReferences)
  );
}

function hasUnknownProperty(value: unknown, property: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasUnknownProperty(item, property));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const containsUnknown = (candidate: unknown): boolean => {
    if (candidate === true) return true;
    if (Array.isArray(candidate)) return candidate.some(containsUnknown);
    if (typeof candidate !== 'object' || candidate === null) return false;
    return Object.values(candidate).some(containsUnknown);
  };
  if (containsUnknown(record[property])) return true;
  return Object.values(record).some((nested) => hasUnknownProperty(nested, property));
}

function plannedArn(change: PlanResourceChange | undefined): string | null {
  if (change === undefined) return null;
  if (typeof change.after.arn === 'string') return change.after.arn;
  if (change.type === 'aws_s3_bucket' && typeof change.after.bucket === 'string') {
    return `arn:aws:s3:::${change.after.bucket}`;
  }
  return null;
}

function plannedMigrationSecretArn(database: PlanResourceChange | undefined): string | null {
  if (database === undefined || !Array.isArray(database.after.master_user_secret)) return null;
  const first = database.after.master_user_secret[0];
  if (typeof first !== 'object' || first === null) return null;
  const arn = (first as { secret_arn?: unknown }).secret_arn;
  return typeof arn === 'string' ? arn : null;
}

function plannedElastiCacheArn(
  plan: unknown,
  change: PlanResourceChange | undefined,
  kind: 'replicationgroup' | 'user',
  identifierProperty: 'replication_group_id' | 'user_id'
): string | null {
  const arn = plannedArn(change);
  if (arn !== null) return arn;
  const accountId = planVariable(plan, 'aws_account_id');
  const region = planVariable(plan, 'aws_region');
  const identifier = change?.after[identifierProperty];
  return typeof accountId === 'string' &&
    typeof region === 'string' &&
    typeof identifier === 'string'
    ? `arn:aws:elasticache:${region}:${accountId}:${kind}:${identifier}`
    : null;
}

function hasCustodyKmsEncryption(
  after: Readonly<Record<string, unknown>>,
  expectedKeyArn: string | null
): boolean {
  if (expectedKeyArn === null) return false;
  if (!Array.isArray(after.rule)) return false;
  return after.rule.some((rawRule) => {
    if (typeof rawRule !== 'object' || rawRule === null) return false;
    const defaults = (rawRule as { apply_server_side_encryption_by_default?: unknown })
      .apply_server_side_encryption_by_default;
    if (!Array.isArray(defaults)) return false;
    return defaults.some(
      (rawDefault) =>
        typeof rawDefault === 'object' &&
        rawDefault !== null &&
        (rawDefault as { sse_algorithm?: unknown }).sse_algorithm === 'aws:kms' &&
        (rawDefault as { kms_master_key_id?: unknown }).kms_master_key_id === expectedKeyArn
    );
  });
}

function hasEnabledVersioning(after: Readonly<Record<string, unknown>>): boolean {
  if (!Array.isArray(after.versioning_configuration)) return false;
  return after.versioning_configuration.some(
    (rawConfiguration) =>
      typeof rawConfiguration === 'object' &&
      rawConfiguration !== null &&
      (rawConfiguration as { status?: unknown }).status === 'Enabled'
  );
}

function hasValidCaptureRetention(
  after: Readonly<Record<string, unknown>>,
  reviewedMaximumDays: unknown
): boolean {
  if (
    typeof reviewedMaximumDays !== 'number' ||
    !Number.isInteger(reviewedMaximumDays) ||
    reviewedMaximumDays < 2
  ) {
    return false;
  }
  if (!Array.isArray(after.rule) || after.rule.length !== 2) return false;
  const abortRules = after.rule.filter(
    (rawRule) =>
      typeof rawRule === 'object' &&
      rawRule !== null &&
      (rawRule as Readonly<Record<string, unknown>>).id === 'abort-incomplete-multipart-uploads'
  );
  if (abortRules.length !== 1) return false;
  const abortRule = abortRules[0] as Readonly<Record<string, unknown>>;
  const abortConfigurations = Array.isArray(abortRule.abort_incomplete_multipart_upload)
    ? abortRule.abort_incomplete_multipart_upload
    : [];
  if (
    abortRule.status !== 'Enabled' ||
    abortConfigurations.length !== 1 ||
    typeof abortConfigurations[0] !== 'object' ||
    abortConfigurations[0] === null ||
    (abortConfigurations[0] as { days_after_initiation?: unknown }).days_after_initiation !== 7 ||
    (Array.isArray(abortRule.expiration) && abortRule.expiration.length > 0) ||
    (Array.isArray(abortRule.noncurrent_version_expiration) &&
      abortRule.noncurrent_version_expiration.length > 0)
  ) {
    return false;
  }
  const captureRules = after.rule.filter((rawRule) => {
    if (typeof rawRule !== 'object' || rawRule === null) return false;
    const filters = Array.isArray((rawRule as Readonly<Record<string, unknown>>).filter)
      ? ((rawRule as Readonly<Record<string, unknown>>).filter as readonly unknown[])
      : [];
    return filters.some(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        (filter as { prefix?: unknown }).prefix === 'captures/'
    );
  });
  if (captureRules.length !== 1) return false;
  return captureRules.every((rawRule) => {
    if (typeof rawRule !== 'object' || rawRule === null) return false;
    const rule = rawRule as Readonly<Record<string, unknown>>;
    const filters = Array.isArray(rule.filter) ? rule.filter : [];
    const expirations = Array.isArray(rule.expiration) ? rule.expiration : [];
    const noncurrentExpirations = Array.isArray(rule.noncurrent_version_expiration)
      ? rule.noncurrent_version_expiration
      : [];
    const prefixMatches = filters.some(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        (filter as { prefix?: unknown }).prefix === 'captures/'
    );
    const currentDays = expirations.flatMap((expiration) => {
      if (typeof expiration !== 'object' || expiration === null) return [];
      const days = (expiration as { days?: unknown }).days;
      return typeof days === 'number' ? [days] : [];
    });
    const noncurrentDays = noncurrentExpirations.flatMap((expiration) => {
      if (typeof expiration !== 'object' || expiration === null) return [];
      const days = (expiration as { noncurrent_days?: unknown }).noncurrent_days;
      return typeof days === 'number' ? [days] : [];
    });
    return (
      rule.status === 'Enabled' &&
      rule.id === 'expire-captures-at-approved-maximum-age' &&
      prefixMatches &&
      currentDays.length === 1 &&
      noncurrentDays.length === 1 &&
      currentDays[0] > 0 &&
      noncurrentDays[0] > 0 &&
      currentDays[0] + noncurrentDays[0] === reviewedMaximumDays
    );
  });
}

function policyStatements(policy: unknown): readonly Readonly<Record<string, unknown>>[] | null {
  let parsed = policy;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const statement = (parsed as { Statement?: unknown }).Statement;
  const statements = Array.isArray(statement) ? statement : [statement];
  if (
    statements.some(
      (candidate) => typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
    )
  ) {
    return null;
  }
  return statements as readonly Readonly<Record<string, unknown>>[];
}

function normalizedStringValue(value: unknown): readonly string[] | null {
  const values = stringValues(value);
  if (values.length === 0 || values.length !== (Array.isArray(value) ? value.length : 1))
    return null;
  return [...values].sort();
}

function normalizedStringMap(value: unknown): Readonly<Record<string, readonly string[]>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).map(([key, raw]) => {
    const values = normalizedStringValue(raw);
    return values === null ? null : ([key, values] as const);
  });
  if (entries.some((entry) => entry === null)) return null;
  return Object.fromEntries(entries as readonly (readonly [string, readonly string[]])[]);
}

function normalizedNestedStringMap(
  value: unknown
): Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).map(([key, raw]) => {
    const nested = normalizedStringMap(raw);
    return nested === null ? null : ([key, nested] as const);
  });
  if (entries.some((entry) => entry === null)) return null;
  return Object.fromEntries(
    entries as readonly (readonly [string, Readonly<Record<string, readonly string[]>>])[]
  );
}

interface ExactPolicyStatement {
  readonly sid?: string;
  readonly effect: string;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly principals?: Readonly<Record<string, readonly string[]>>;
  readonly conditions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

function normalizePolicyStatement(
  statement: Readonly<Record<string, unknown>>
): ExactPolicyStatement | null {
  const actions = normalizedStringValue(statement.Action);
  const resources = normalizedStringValue(statement.Resource);
  if (typeof statement.Effect !== 'string' || actions === null || resources === null) return null;
  const principals =
    statement.Principal === undefined ? undefined : normalizedStringMap(statement.Principal);
  const conditions =
    statement.Condition === undefined ? undefined : normalizedNestedStringMap(statement.Condition);
  if (principals === null || conditions === null) return null;
  return {
    ...(typeof statement.Sid === 'string' ? { sid: statement.Sid } : {}),
    effect: statement.Effect,
    actions,
    resources,
    ...(principals === undefined ? {} : { principals }),
    ...(conditions === undefined ? {} : { conditions }),
  };
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableValue(nested)}`)
    .join(',')}}`;
}

function hasExactPolicyStatements(
  policy: unknown,
  expected: readonly ExactPolicyStatement[]
): boolean {
  const statements = policyStatements(policy);
  if (statements === null) return false;
  const normalized = statements.map(normalizePolicyStatement);
  return (
    normalized.every((statement): statement is ExactPolicyStatement => statement !== null) &&
    exactStringSet(normalized.map(stableValue), expected.map(stableValue))
  );
}

function stringValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is string => typeof candidate === 'string');
}

function tags(after: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return typeof after.tags_all === 'object' && after.tags_all !== null
    ? (after.tags_all as Readonly<Record<string, unknown>>)
    : {};
}

interface PolicyGrant {
  readonly action: string;
  readonly effect: string;
  readonly resource: string;
}

function policyGrants(policy: unknown): readonly PolicyGrant[] | null {
  const statements = policyStatements(policy);
  if (statements === null) return null;
  const grants: PolicyGrant[] = [];
  for (const statement of statements) {
    const actions = stringValues(statement.Action);
    const resources = stringValues(statement.Resource);
    if (typeof statement.Effect !== 'string' || actions.length === 0 || resources.length === 0) {
      return null;
    }
    for (const action of actions) {
      for (const resource of resources) {
        grants.push({ action, effect: statement.Effect, resource });
      }
    }
  }
  return grants;
}

function exactGrants(actual: readonly PolicyGrant[], expected: readonly PolicyGrant[]): boolean {
  const key = ({ action, effect, resource }: PolicyGrant) =>
    `${effect}\u0000${action}\u0000${resource}`;
  return exactStringSet(actual.map(key), expected.map(key));
}

function hasExactServiceTrust(policy: unknown, service: string): boolean {
  const statements = policyStatements(policy);
  if (statements === null || statements.length !== 1) return false;
  const statement = statements[0];
  if (
    statement.Effect !== 'Allow' ||
    !exactStringSet(stringValues(statement.Action), ['sts:AssumeRole'])
  ) {
    return false;
  }
  if (typeof statement.Principal !== 'object' || statement.Principal === null) return false;
  const principal = statement.Principal as Readonly<Record<string, unknown>>;
  return (
    exactStringSet(Object.keys(principal), ['Service']) &&
    exactStringSet(stringValues(principal.Service), [service])
  );
}

function canonicalAddress(address: string): string {
  return address.replace(/\[[^\]]+\]/g, '');
}

function ipv4Range(cidr: string): readonly [number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/.exec(cidr);
  if (match === null) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  const prefix = Number(match[5]);
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(value / size) * size;
  return [start, start + size - 1];
}

function ipv4Address(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

function resolverCidr(vpcCidr: unknown): string | null {
  if (typeof vpcCidr !== 'string') return null;
  const range = ipv4Range(vpcCidr);
  return range === null ? null : `${ipv4Address(range[0] + 2)}/32`;
}

function coversAllIpv4(cidrs: readonly string[]): boolean {
  const ranges = cidrs.flatMap((cidr) => {
    const range = ipv4Range(cidr);
    return range === null ? [] : [range];
  });
  ranges.sort((left, right) => left[0] - right[0]);
  let coveredThrough = -1;
  for (const [start, end] of ranges) {
    if (start > coveredThrough + 1) return false;
    coveredThrough = Math.max(coveredThrough, end);
    if (coveredThrough >= 0xffffffff) return true;
  }
  return false;
}

function inlineCidrs(after: Readonly<Record<string, unknown>>): {
  ipv4: readonly string[];
  ipv6: readonly string[];
} {
  if (!Array.isArray(after.egress)) return { ipv4: [], ipv6: [] };
  const ipv4: string[] = [];
  const ipv6: string[] = [];
  for (const rawRule of after.egress) {
    if (typeof rawRule !== 'object' || rawRule === null) continue;
    const rule = rawRule as Readonly<Record<string, unknown>>;
    ipv4.push(...stringValues(rule.cidr_blocks));
    ipv6.push(...stringValues(rule.ipv6_cidr_blocks));
  }
  return { ipv4, ipv6 };
}

export function validateAflTradeNonproductionPlan(
  plan: unknown,
  options: AflTradeNonproductionPlanValidationOptions
): readonly AflTradeNonproductionPlanIssue[] {
  const changes = parseResourceChanges(plan);
  if (changes === null) {
    return [
      issue(
        'PLAN_SHAPE_INVALID',
        'OpenTofu plan JSON must contain a resource_changes array before it can be approved.'
      ),
    ];
  }

  const configurationResources = parseConfigurationResources(plan);
  const issues: AflTradeNonproductionPlanIssue[] = [];
  const configurationAttestation = findByAddress(
    changes,
    'terraform_data.configuration_attestation'
  );
  const configurationIsAttested =
    /^[a-f0-9]{64}$/.test(options.configurationSourceDigest) &&
    configurationAttestation?.after.input === options.configurationSourceDigest;
  if (!configurationIsAttested) {
    issues.push(
      issue(
        'CONFIGURATION_ATTESTATION_INVALID',
        'The saved plan must attest the exact reviewed Terraform source digest.',
        configurationAttestation?.address ?? 'terraform_data.configuration_attestation'
      )
    );
  }
  const database = findByAddress(changes, 'aws_db_instance.outcomes');
  const databaseKeyArn = plannedArn(findByAddress(changes, 'aws_kms_key.database'));
  if (database === undefined) {
    issues.push(issue('DATABASE_MISSING', 'The isolated outcomes PostgreSQL instance is missing.'));
  } else {
    if (tags(database.after).Environment !== 'non_production') {
      issues.push(
        issue(
          'AUTHORITY_ENVIRONMENT_INVALID',
          'The stack must use the canonical non_production authority environment tag.',
          database.address
        )
      );
    }
    if (database.after.publicly_accessible !== false) {
      issues.push(
        issue(
          'DATABASE_PUBLIC',
          'The outcomes database must not be publicly accessible.',
          database.address
        )
      );
    }
    if (database.after.storage_encrypted !== true) {
      issues.push(
        issue(
          'DATABASE_UNENCRYPTED',
          'The outcomes database must encrypt storage.',
          database.address
        )
      );
    }
    const databaseKmsIsKnown =
      databaseKeyArn !== null && database.after.kms_key_id === databaseKeyArn;
    const databaseKmsIsReferenced =
      hasUnknownProperty(database.afterUnknown, 'kms_key_id') &&
      configurationExpressionReferences(
        configurationResources,
        database.address,
        'kms_key_id',
        'aws_kms_key.database.arn'
      );
    if (!databaseKmsIsKnown && !databaseKmsIsReferenced) {
      issues.push(
        issue(
          'DATABASE_KMS_MISSING',
          'The outcomes database must use an explicit KMS key.',
          database.address
        )
      );
    }
    const masterSecretKmsIsKnown =
      databaseKeyArn !== null && database.after.master_user_secret_kms_key_id === databaseKeyArn;
    const masterSecretKmsIsReferenced =
      hasUnknownProperty(database.afterUnknown, 'master_user_secret_kms_key_id') &&
      configurationExpressionReferences(
        configurationResources,
        database.address,
        'master_user_secret_kms_key_id',
        'aws_kms_key.database.arn'
      );
    if (
      database.after.manage_master_user_password !== true ||
      database.after.username !== 'afl_trade_migration' ||
      (!masterSecretKmsIsKnown && !masterSecretKmsIsReferenced)
    ) {
      issues.push(
        issue(
          'DATABASE_SECRET_POLICY_INVALID',
          'The outcomes database must retain the RDS-managed migration credential under the reviewed database key and username.',
          database.address
        )
      );
    }
    if (
      typeof database.after.backup_retention_period !== 'number' ||
      database.after.backup_retention_period < 7 ||
      database.after.backup_retention_period !==
        planVariable(plan, 'database_backup_retention_days')
    ) {
      issues.push(
        issue(
          'DATABASE_BACKUPS_DISABLED',
          'The outcomes database must retain automated backups.',
          database.address
        )
      );
    }
    if (database.after.deletion_protection !== true) {
      issues.push(
        issue(
          'DATABASE_DELETION_UNPROTECTED',
          'The outcomes database must enable deletion protection.',
          database.address
        )
      );
    }
  }

  const cache = findByAddress(changes, 'aws_elasticache_replication_group.admission');
  if (cache === undefined) {
    issues.push(issue('CACHE_MISSING', 'The isolated Redis admission and lease store is missing.'));
  } else {
    if (cache.after.at_rest_encryption_enabled !== true) {
      issues.push(
        issue(
          'CACHE_AT_REST_UNENCRYPTED',
          'The Redis store must encrypt data at rest.',
          cache.address
        )
      );
    }
    if (cache.after.transit_encryption_enabled !== true) {
      issues.push(
        issue(
          'CACHE_TRANSIT_UNENCRYPTED',
          'The Redis store must require encryption in transit.',
          cache.address
        )
      );
    }
  }

  const custodyBucket = findByAddress(changes, 'aws_s3_bucket.custody');
  const bucketAccountId = planVariable(plan, 'aws_account_id');
  const bucketRegion = planVariable(plan, 'aws_region');
  const expectedBucketStem =
    typeof bucketAccountId === 'string' && typeof bucketRegion === 'string'
      ? `statly-afl-trade-np-${bucketAccountId}-${bucketRegion}`
      : null;
  const expectedCustodyBucketName =
    expectedBucketStem === null ? null : `${expectedBucketStem}-custody`;
  const expectedLoggingBucketName =
    expectedBucketStem === null ? null : `${expectedBucketStem}-logs`;
  const custodyBucketId = expectedCustodyBucketName;
  if (custodyBucket === undefined) {
    issues.push(issue('CUSTODY_BUCKET_MISSING', 'The immutable source-custody bucket is missing.'));
  } else if (
    expectedCustodyBucketName === null ||
    custodyBucket.after.bucket !== expectedCustodyBucketName
  ) {
    issues.push(
      issue(
        'CUSTODY_SAFETY_POLICY_INVALID',
        'The custody bucket must use the exact reviewed account-and-region identity.',
        custodyBucket.address
      )
    );
  }

  const publicAccess = findByAddress(changes, 'aws_s3_bucket_public_access_block.custody');
  if (publicAccess === undefined) {
    issues.push(
      issue(
        'CUSTODY_PUBLIC_ACCESS_BLOCK_MISSING',
        'The custody bucket public-access block is missing.'
      )
    );
  } else if (
    publicAccess.after.block_public_acls !== true ||
    publicAccess.after.block_public_policy !== true ||
    !plannedStringMatchesExactResource(
      publicAccess,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    ) ||
    publicAccess.after.ignore_public_acls !== true ||
    publicAccess.after.restrict_public_buckets !== true
  ) {
    issues.push(
      issue(
        'CUSTODY_PUBLIC_ACCESS_UNBLOCKED',
        'Every S3 public-access block control must be enabled.',
        publicAccess.address
      )
    );
  }

  const encryption = findByAddress(
    changes,
    'aws_s3_bucket_server_side_encryption_configuration.custody'
  );
  const custodyKeyArn = plannedArn(findByAddress(changes, 'aws_kms_key.custody'));
  const encryptionUsesKnownCustodyKey =
    encryption !== undefined && hasCustodyKmsEncryption(encryption.after, custodyKeyArn);
  const encryptionUsesReferencedCustodyKey =
    encryption !== undefined &&
    hasUnknownProperty(encryption.afterUnknown, 'kms_master_key_id') &&
    exactStringSet(
      specificReferences(
        findConfigurationByAddress(configurationResources, encryption.address)?.expressions.rule
      ),
      ['aws_kms_key.custody.arn']
    );
  if (!encryptionUsesKnownCustodyKey && !encryptionUsesReferencedCustodyKey) {
    issues.push(
      issue(
        'CUSTODY_ENCRYPTION_MISSING',
        'The custody bucket must use an explicit KMS key for default encryption.',
        encryption?.address
      )
    );
  }
  if (
    !plannedStringMatchesExactResource(
      encryption,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    )
  ) {
    issues.push(
      issue(
        'CUSTODY_SAFETY_POLICY_INVALID',
        'The custody encryption control must target only the reviewed custody bucket.',
        encryption?.address
      )
    );
  }

  const versioning = findByAddress(changes, 'aws_s3_bucket_versioning.custody');
  if (versioning === undefined) {
    issues.push(
      issue('CUSTODY_VERSIONING_MISSING', 'The custody bucket versioning resource is missing.')
    );
  } else if (
    !hasEnabledVersioning(versioning.after) ||
    !plannedStringMatchesExactResource(
      versioning,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    )
  ) {
    issues.push(
      issue(
        'CUSTODY_VERSIONING_DISABLED',
        'The custody bucket must enable versioning.',
        versioning.address
      )
    );
  }

  const retention = findByAddress(changes, 'aws_s3_bucket_lifecycle_configuration.custody');
  if (retention === undefined) {
    issues.push(
      issue(
        'CUSTODY_RETENTION_MISSING',
        'The custody bucket capture-retention lifecycle is missing.'
      )
    );
  } else if (
    !hasValidCaptureRetention(retention.after, planVariable(plan, 'capture_retention_days')) ||
    !plannedStringMatchesExactResource(
      retention,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    )
  ) {
    issues.push(
      issue(
        'CUSTODY_RETENTION_INVALID',
        'The custody bucket must expire current and noncurrent captures at one explicit maximum age.',
        retention.address
      )
    );
  }

  const custodySafety = findByAddress(changes, 'aws_s3_bucket_policy.custody_safety');
  if (custodySafety === undefined) {
    issues.push(
      issue(
        'CUSTODY_SAFETY_POLICY_MISSING',
        'The custody TLS, conditional-write, encryption and deletion safety policy is missing.'
      )
    );
  } else {
    const accountId = planVariable(plan, 'aws_account_id');
    const region = planVariable(plan, 'aws_region');
    const bucketArn = plannedArn(custodyBucket);
    const identitiesAreKnown =
      typeof accountId === 'string' && typeof region === 'string' && bucketArn !== null;
    const exactBucketArn = bucketArn ?? '';
    const expectedKeyAliasArn = identitiesAreKnown
      ? `arn:aws:kms:${region}:${accountId}:alias/statly-afl-trade-non-production-custody`
      : '';
    const expectedRetentionRoleArn = identitiesAreKnown
      ? `arn:aws:iam::${accountId}:role/statly-afl-trade-non-production-retention-admin`
      : '';
    const expectedStatements: readonly ExactPolicyStatement[] = identitiesAreKnown
      ? [
          {
            sid: 'RequireTls',
            effect: 'Deny',
            actions: ['s3:*'],
            resources: [exactBucketArn, `${exactBucketArn}/*`].sort(),
            principals: { AWS: ['*'] },
            conditions: { Bool: { 'aws:SecureTransport': ['false'] } },
          },
          {
            sid: 'RequireConditionalCreation',
            effect: 'Deny',
            actions: ['s3:PutObject'],
            resources: [`${exactBucketArn}/*`],
            principals: { AWS: ['*'] },
            conditions: { Null: { 's3:if-none-match': ['true'] } },
          },
          {
            sid: 'RequireKmsEncryption',
            effect: 'Deny',
            actions: ['s3:PutObject'],
            resources: [`${exactBucketArn}/*`],
            principals: { AWS: ['*'] },
            conditions: {
              StringNotEquals: { 's3:x-amz-server-side-encryption': ['aws:kms'] },
            },
          },
          {
            sid: 'RequireCustodyKmsKey',
            effect: 'Deny',
            actions: ['s3:PutObject'],
            resources: [`${exactBucketArn}/*`],
            principals: { AWS: ['*'] },
            conditions: {
              StringNotEquals: {
                's3:x-amz-server-side-encryption-aws-kms-key-id': [expectedKeyAliasArn],
              },
            },
          },
          {
            sid: 'DenyUnreviewedDeletion',
            effect: 'Deny',
            actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'].sort(),
            resources: [`${exactBucketArn}/*`],
            principals: { AWS: ['*'] },
            conditions: { ArnNotEquals: { 'aws:PrincipalArn': [expectedRetentionRoleArn] } },
          },
        ]
      : [];
    if (
      !identitiesAreKnown ||
      !plannedStringMatchesExactResource(
        custodySafety,
        configurationResources,
        'bucket',
        custodyBucketId,
        'aws_s3_bucket.custody.id'
      ) ||
      !hasExactPolicyStatements(custodySafety.after.policy, expectedStatements)
    ) {
      issues.push(
        issue(
          'CUSTODY_SAFETY_POLICY_INVALID',
          'The custody bucket policy must expose only the complete reviewed safety statement set.',
          custodySafety.address
        )
      );
    }
  }

  const loggingBucket = findByAddress(changes, 'aws_s3_bucket.logging');
  const loggingBucketId = expectedLoggingBucketName;
  if (
    loggingBucket === undefined ||
    expectedLoggingBucketName === null ||
    loggingBucket.after.bucket !== expectedLoggingBucketName
  ) {
    issues.push(
      issue(
        'LOGGING_SAFETY_POLICY_INVALID',
        'The access-log bucket must use the exact reviewed account-and-region identity.',
        loggingBucket?.address ?? 'aws_s3_bucket.logging'
      )
    );
  }
  const loggingOwnership = findByAddress(changes, 'aws_s3_bucket_ownership_controls.logging');
  const loggingPublicAccess = findByAddress(changes, 'aws_s3_bucket_public_access_block.logging');
  const loggingEncryption = findByAddress(
    changes,
    'aws_s3_bucket_server_side_encryption_configuration.logging'
  );
  const loggingVersioning = findByAddress(changes, 'aws_s3_bucket_versioning.logging');
  const loggingPolicy = findByAddress(changes, 'aws_s3_bucket_policy.logging');
  const custodyOwnership = findByAddress(changes, 'aws_s3_bucket_ownership_controls.custody');
  const custodyLogging = findByAddress(changes, 'aws_s3_bucket_logging.custody');
  const custodyOwnershipRule = Array.isArray(custodyOwnership?.after.rule)
    ? custodyOwnership.after.rule[0]
    : null;
  const custodyBoundaryControlsAreExact =
    typeof custodyOwnershipRule === 'object' &&
    custodyOwnershipRule !== null &&
    (custodyOwnershipRule as Readonly<Record<string, unknown>>).object_ownership ===
      'BucketOwnerEnforced' &&
    plannedStringMatchesExactResource(
      custodyOwnership,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    ) &&
    plannedStringMatchesExactResource(
      custodyLogging,
      configurationResources,
      'bucket',
      custodyBucketId,
      'aws_s3_bucket.custody.id'
    ) &&
    plannedStringMatchesExactResource(
      custodyLogging,
      configurationResources,
      'target_bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    ) &&
    custodyLogging?.after.target_prefix === 'access/';
  if (!custodyBoundaryControlsAreExact) {
    issues.push(
      issue(
        'CUSTODY_SAFETY_POLICY_INVALID',
        'Custody ownership and access-log delivery must remain bound to the exact reviewed buckets and prefix.',
        custodyLogging?.address ?? custodyOwnership?.address
      )
    );
  }
  const loggingOwnershipRule = Array.isArray(loggingOwnership?.after.rule)
    ? loggingOwnership.after.rule[0]
    : null;
  const loggingEncryptionRule = Array.isArray(loggingEncryption?.after.rule)
    ? loggingEncryption.after.rule[0]
    : null;
  const loggingEncryptionDefault =
    typeof loggingEncryptionRule === 'object' &&
    loggingEncryptionRule !== null &&
    Array.isArray(
      (loggingEncryptionRule as Readonly<Record<string, unknown>>)
        .apply_server_side_encryption_by_default
    )
      ? (loggingEncryptionRule as Readonly<Record<string, unknown>>)
          .apply_server_side_encryption_by_default[0]
      : null;
  const loggingControlsAreExact =
    typeof loggingOwnershipRule === 'object' &&
    loggingOwnershipRule !== null &&
    (loggingOwnershipRule as Readonly<Record<string, unknown>>).object_ownership ===
      'BucketOwnerEnforced' &&
    plannedStringMatchesExactResource(
      loggingOwnership,
      configurationResources,
      'bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    ) &&
    loggingPublicAccess?.after.block_public_acls === true &&
    loggingPublicAccess.after.block_public_policy === true &&
    loggingPublicAccess.after.ignore_public_acls === true &&
    loggingPublicAccess.after.restrict_public_buckets === true &&
    plannedStringMatchesExactResource(
      loggingPublicAccess,
      configurationResources,
      'bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    ) &&
    typeof loggingEncryptionDefault === 'object' &&
    loggingEncryptionDefault !== null &&
    (loggingEncryptionDefault as Readonly<Record<string, unknown>>).sse_algorithm === 'AES256' &&
    plannedStringMatchesExactResource(
      loggingEncryption,
      configurationResources,
      'bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    ) &&
    loggingVersioning !== undefined &&
    hasEnabledVersioning(loggingVersioning.after) &&
    plannedStringMatchesExactResource(
      loggingVersioning,
      configurationResources,
      'bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    ) &&
    plannedStringMatchesExactResource(
      loggingPolicy,
      configurationResources,
      'bucket',
      loggingBucketId,
      'aws_s3_bucket.logging.id'
    );
  const accountIdForLogging = planVariable(plan, 'aws_account_id');
  const loggingBucketArn = plannedArn(loggingBucket);
  const custodyBucketArnForLogging = plannedArn(findByAddress(changes, 'aws_s3_bucket.custody'));
  const loggingIdentitiesAreKnown =
    typeof accountIdForLogging === 'string' &&
    loggingBucketArn !== null &&
    custodyBucketArnForLogging !== null;
  const loggingExpected: readonly ExactPolicyStatement[] = loggingIdentitiesAreKnown
    ? [
        {
          sid: 'RequireTls',
          effect: 'Deny',
          actions: ['s3:*'],
          resources: [loggingBucketArn, `${loggingBucketArn}/*`].sort(),
          principals: { AWS: ['*'] },
          conditions: { Bool: { 'aws:SecureTransport': ['false'] } },
        },
        {
          sid: 'PermitS3AccessLogDelivery',
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`${loggingBucketArn}/access/*`],
          principals: { Service: ['logging.s3.amazonaws.com'] },
          conditions: {
            ArnLike: { 'aws:SourceArn': [custodyBucketArnForLogging] },
            StringEquals: { 'aws:SourceAccount': [accountIdForLogging] },
          },
        },
      ]
    : [];
  if (
    !loggingControlsAreExact ||
    loggingPolicy === undefined ||
    !loggingIdentitiesAreKnown ||
    !hasExactPolicyStatements(loggingPolicy.after.policy, loggingExpected)
  ) {
    issues.push(
      issue(
        'LOGGING_SAFETY_POLICY_INVALID',
        'The access-log bucket must retain its exact ownership, encryption, versioning, public-access and delivery policy controls.',
        loggingPolicy?.address ?? 'aws_s3_bucket_policy.logging'
      )
    );
  }

  const capturePolicy = findByAddress(changes, 'aws_iam_policy.capture');
  if (capturePolicy === undefined) {
    issues.push(issue('CAPTURE_IAM_POLICY_MISSING', 'The capture worker IAM policy is missing.'));
  } else {
    const grants = policyGrants(capturePolicy.after.policy);
    const custodyBucketArn = plannedArn(findByAddress(changes, 'aws_s3_bucket.custody'));
    const cacheReplicationArn = plannedElastiCacheArn(
      plan,
      cache,
      'replicationgroup',
      'replication_group_id'
    );
    const cacheUserArn = plannedElastiCacheArn(
      plan,
      findByAddress(changes, 'aws_elasticache_user.capture'),
      'user',
      'user_id'
    );
    if (grants === null) {
      issues.push(
        issue(
          'CAPTURE_IAM_POLICY_INVALID',
          'The capture worker policy must be fully rendered so its exact object prefix can be proven.',
          capturePolicy.address
        )
      );
    } else {
      const actions = grants.map(({ action }) => action);
      const resources = grants.map(({ resource }) => resource);
      const hasWildcardAction = actions.some((action) => action === '*' || action.endsWith(':*'));
      const hasWildcardResource = resources.includes('*');
      if (hasWildcardAction) {
        issues.push(
          issue(
            'CAPTURE_IAM_WILDCARD_ACTION',
            'The capture worker policy must not grant wildcard actions.',
            capturePolicy.address
          )
        );
      }
      if (hasWildcardResource) {
        issues.push(
          issue(
            'CAPTURE_IAM_WILDCARD_RESOURCE',
            'The capture worker policy must not grant a wildcard resource.',
            capturePolicy.address
          )
        );
      }
      if (!hasWildcardAction && !hasWildcardResource) {
        const allowedActions = ['s3:GetObject', 's3:PutObject', 'elasticache:Connect'];
        const disallowedAction = actions.find((action) => !allowedActions.includes(action));
        if (disallowedAction !== undefined) {
          issues.push(
            issue(
              'CAPTURE_IAM_ACTION_NOT_ALLOWED',
              `The capture worker policy action ${disallowedAction} is outside the exact allowlist.`,
              capturePolicy.address
            )
          );
        }

        const identitiesAreKnown =
          custodyBucketArn !== null && cacheReplicationArn !== null && cacheUserArn !== null;
        const expected: PolicyGrant[] = identitiesAreKnown
          ? [
              {
                action: 's3:GetObject',
                effect: 'Allow',
                resource: `${custodyBucketArn}/captures/*`,
              },
              {
                action: 's3:PutObject',
                effect: 'Allow',
                resource: `${custodyBucketArn}/captures/*`,
              },
              {
                action: 'elasticache:Connect',
                effect: 'Allow',
                resource: cacheReplicationArn,
              },
              { action: 'elasticache:Connect', effect: 'Allow', resource: cacheUserArn },
            ]
          : [];
        if (
          identitiesAreKnown &&
          grants.some((grant) =>
            expected.every(
              (allowed) => allowed.action !== grant.action || allowed.resource !== grant.resource
            )
          )
        ) {
          issues.push(
            issue(
              'CAPTURE_IAM_RESOURCE_NOT_ALLOWED',
              'The capture worker policy must name only this stack custody prefix and Redis identities.',
              capturePolicy.address
            )
          );
        }
        if (
          disallowedAction === undefined &&
          (!identitiesAreKnown || (identitiesAreKnown && !exactGrants(grants, expected)))
        ) {
          issues.push(
            issue(
              'CAPTURE_IAM_POLICY_INVALID',
              'The capture worker policy must contain the complete exact Allow grant set.',
              capturePolicy.address
            )
          );
        }
      }
    }
  }

  const captureKmsPolicy = findByAddress(changes, 'aws_iam_role_policy.capture_kms');
  if (captureKmsPolicy === undefined) {
    issues.push(issue('CAPTURE_KMS_POLICY_MISSING', 'The capture custody-KMS policy is missing.'));
  } else {
    const allowedActions = ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'];
    const accountId = planVariable(plan, 'aws_account_id');
    const region = planVariable(plan, 'aws_region');
    const identitiesAreKnown = typeof accountId === 'string' && typeof region === 'string';
    const expected = identitiesAreKnown
      ? [
          {
            effect: 'Allow',
            actions: [...allowedActions].sort(),
            resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
            conditions: {
              'ForAnyValue:StringEquals': {
                'kms:ResourceAliases': ['alias/statly-afl-trade-non-production-custody'],
              },
            },
          },
        ]
      : [];
    if (!identitiesAreKnown || !hasExactPolicyStatements(captureKmsPolicy.after.policy, expected)) {
      issues.push(
        issue(
          'CAPTURE_KMS_POLICY_INVALID',
          'The capture custody-KMS policy must contain one fully rendered exact key-alias grant.',
          captureKmsPolicy.address
        )
      );
    }
  }

  const runtimeSecret = findByAddress(changes, 'aws_secretsmanager_secret.runtime_database_url');
  if (runtimeSecret === undefined) {
    issues.push(
      issue(
        'RUNTIME_DATABASE_SECRET_MISSING',
        'The operator-populated runtime database secret is missing.'
      )
    );
  }
  const taskExecutionPolicy = findByAddress(changes, 'aws_iam_role_policy.task_execution');
  const migrationPolicy = findByCanonicalAddress(changes, 'aws_iam_role_policy.migration');
  const migrationAccessFlag = planVariable(plan, 'enable_migration_secret_access');
  const migrationAccessEnabled = migrationAccessFlag === true;
  if (taskExecutionPolicy === undefined) {
    issues.push(
      issue('TASK_EXECUTION_POLICY_MISSING', 'The task execution secret policy is missing.')
    );
  }
  if (migrationAccessEnabled && migrationPolicy === undefined) {
    issues.push(
      issue(
        'MIGRATION_POLICY_MISSING',
        'The enabled RDS-managed migration-secret policy is missing.'
      )
    );
  }
  const accountIdForSecrets = planVariable(plan, 'aws_account_id');
  const regionForSecrets = planVariable(plan, 'aws_region');
  const secretIdentitiesAreKnown =
    typeof accountIdForSecrets === 'string' && typeof regionForSecrets === 'string';
  const databaseKeyPattern = `arn:aws:kms:${regionForSecrets}:${accountIdForSecrets}:key/*`;
  const databaseAlias = 'alias/statly-afl-trade-non-production-database';
  const runtimeSecretPattern = `arn:aws:secretsmanager:${regionForSecrets}:${accountIdForSecrets}:secret:/statly/afl-trade/non_production/outcomes-runtime-database-url-*`;
  const taskExpected: readonly ExactPolicyStatement[] = [
    {
      sid: 'PullExactDispatcherRepository',
      effect: 'Allow',
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
      ].sort(),
      resources: [
        `arn:aws:ecr:${regionForSecrets}:${accountIdForSecrets}:repository/statly-afl-trade-non-production-external-dispatcher`,
      ],
    },
    {
      sid: 'ObtainEcrAuthorizationToken',
      effect: 'Allow',
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    },
    {
      sid: 'WriteDispatcherLogs',
      effect: 'Allow',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'].sort(),
      resources: [
        `arn:aws:logs:${regionForSecrets}:${accountIdForSecrets}:log-group:/statly/afl-trade/non_production/external-dispatcher:*`,
      ],
    },
    {
      sid: 'ReadExactRuntimeSecret',
      effect: 'Allow',
      actions: ['secretsmanager:GetSecretValue'],
      resources: [runtimeSecretPattern],
    },
    {
      sid: 'DecryptExactRuntimeSecret',
      effect: 'Allow',
      actions: ['kms:Decrypt', 'kms:DescribeKey'].sort(),
      resources: [databaseKeyPattern],
      conditions: {
        'ForAnyValue:StringEquals': { 'kms:ResourceAliases': [databaseAlias] },
      },
    },
  ];
  if (
    taskExecutionPolicy !== undefined &&
    (!secretIdentitiesAreKnown ||
      !hasExactPolicyStatements(taskExecutionPolicy.after.policy, taskExpected))
  ) {
    issues.push(
      issue(
        'DATABASE_SECRET_POLICY_INVALID',
        'The runtime task policy must be fully rendered and match its complete exact grants.'
      )
    );
  }
  const rdsManagedMigrationSecretArn = plannedMigrationSecretArn(database);
  const migrationExpected: readonly ExactPolicyStatement[] =
    rdsManagedMigrationSecretArn === null
      ? []
      : [
          {
            sid: 'ReadExactMigrationSecret',
            effect: 'Allow',
            actions: ['secretsmanager:GetSecretValue'],
            resources: [rdsManagedMigrationSecretArn],
          },
          {
            sid: 'DecryptExactDatabaseSecret',
            effect: 'Allow',
            actions: ['kms:Decrypt', 'kms:DescribeKey'].sort(),
            resources: [databaseKeyPattern],
            conditions: {
              'ForAnyValue:StringEquals': { 'kms:ResourceAliases': [databaseAlias] },
            },
          },
        ];
  if (typeof migrationAccessFlag !== 'boolean') {
    issues.push(
      issue(
        'DATABASE_SECRET_POLICY_INVALID',
        'The migration-secret access phase must be explicitly enabled or disabled.'
      )
    );
  } else if (!migrationAccessEnabled && migrationPolicy !== undefined) {
    issues.push(
      issue(
        'DATABASE_SECRET_POLICY_INVALID',
        'The base foundation must not grant migration-secret access before the RDS-managed ARN is reviewed.'
      )
    );
  } else if (
    migrationAccessEnabled &&
    migrationPolicy !== undefined &&
    (!secretIdentitiesAreKnown ||
      rdsManagedMigrationSecretArn === null ||
      !hasExactPolicyStatements(migrationPolicy.after.policy, migrationExpected))
  ) {
    issues.push(
      issue(
        'DATABASE_SECRET_POLICY_INVALID',
        'The migration role may read only the exact plan-known RDS-managed master secret and database KMS alias.'
      )
    );
  }

  const allowedIamAddresses = new Set([
    'aws_iam_policy.capture',
    'aws_iam_role.capture',
    'aws_iam_role.migration',
    'aws_iam_role.retention_admin',
    'aws_iam_role.scheduler',
    'aws_iam_role.task_execution',
    'aws_iam_role_policy.capture_kms',
    'aws_iam_role_policy.migration',
    'aws_iam_role_policy.retention_admin',
    'aws_iam_role_policy.scheduler',
    'aws_iam_role_policy.task_execution',
    'aws_iam_role_policy_attachments_exclusive.capture',
    'aws_iam_role_policy_attachments_exclusive.migration',
    'aws_iam_role_policy_attachments_exclusive.retention_admin',
    'aws_iam_role_policy_attachments_exclusive.scheduler',
    'aws_iam_role_policy_attachments_exclusive.task_execution',
    'aws_iam_role_policies_exclusive.capture',
    'aws_iam_role_policies_exclusive.migration',
    'aws_iam_role_policies_exclusive.retention_admin',
    'aws_iam_role_policies_exclusive.scheduler',
    'aws_iam_role_policies_exclusive.task_execution',
  ]);
  const governedIamTypes = new Set([
    'aws_iam_policy',
    'aws_iam_policy_attachment',
    'aws_iam_role',
    'aws_iam_role_policy',
    'aws_iam_role_policy_attachment',
    'aws_iam_role_policy_attachments_exclusive',
    'aws_iam_role_policies_exclusive',
  ]);
  const unexpectedIam = changes.find(
    (change) =>
      governedIamTypes.has(change.type) &&
      !allowedIamAddresses.has(canonicalAddress(change.address))
  );
  if (unexpectedIam !== undefined) {
    issues.push(
      issue(
        'IAM_GRAPH_INVALID',
        'The plan contains an IAM role, policy or attachment outside the reviewed exact graph.',
        unexpectedIam.address
      )
    );
  }
  const captureAttachment = findByAddress(
    changes,
    'aws_iam_role_policy_attachments_exclusive.capture'
  );
  const accountIdForIam = planVariable(plan, 'aws_account_id');
  const expectedCapturePolicyArn =
    typeof accountIdForIam === 'string'
      ? `arn:aws:iam::${accountIdForIam}:policy/statly-afl-trade-non-production-capture`
      : null;
  const captureAttachmentPolicyIsExact =
    captureAttachment !== undefined &&
    expectedCapturePolicyArn !== null &&
    exactRenderedStringSet(captureAttachment.after.policy_arns, [expectedCapturePolicyArn]);
  const requiredRoles = [
    ['capture', 'ecs-tasks.amazonaws.com'],
    ['migration', 'ecs-tasks.amazonaws.com'],
    ['retention_admin', 'ecs-tasks.amazonaws.com'],
    ['scheduler', 'scheduler.amazonaws.com'],
    ['task_execution', 'ecs-tasks.amazonaws.com'],
  ] as const;
  for (const [name, expectedService] of requiredRoles) {
    const role = findByAddress(changes, `aws_iam_role.${name}`);
    if (
      role === undefined ||
      !hasExactServiceTrust(role.after.assume_role_policy, expectedService)
    ) {
      issues.push(
        issue(
          'ROLE_TRUST_INVALID',
          'Every reviewed role must expose one exact service trust and no additional principal.',
          role?.address ?? `aws_iam_role.${name}`
        )
      );
    }
    const roleConfiguration = findConfigurationByAddress(
      configurationResources,
      `aws_iam_role.${name}`
    );
    const managedPolicyArns = Array.isArray(role?.after.managed_policy_arns)
      ? role.after.managed_policy_arns
      : null;
    const captureManagedPoliciesAreKnownExact =
      name === 'capture' &&
      expectedCapturePolicyArn !== null &&
      managedPolicyArns !== null &&
      exactRenderedStringSet(managedPolicyArns, [expectedCapturePolicyArn]);
    const captureManagedPoliciesAreComputedFromExactAttachment =
      name === 'capture' &&
      role !== undefined &&
      hasUnknownProperty(role.afterUnknown, 'managed_policy_arns') &&
      roleConfiguration?.expressions.managed_policy_arns === undefined &&
      captureAttachmentPolicyIsExact;
    const noManagedPoliciesAreKnown = managedPolicyArns !== null && managedPolicyArns.length === 0;
    const noManagedPoliciesAreComputed =
      role !== undefined &&
      hasUnknownProperty(role.afterUnknown, 'managed_policy_arns') &&
      roleConfiguration?.expressions.managed_policy_arns === undefined;
    const managedPoliciesAreExact =
      roleConfiguration?.expressions.managed_policy_arns === undefined &&
      (name === 'capture'
        ? captureManagedPoliciesAreKnownExact ||
          captureManagedPoliciesAreComputedFromExactAttachment
        : noManagedPoliciesAreKnown || noManagedPoliciesAreComputed);
    if (
      role !== undefined &&
      (!Array.isArray(role.after.inline_policy) ||
        role.after.inline_policy.length !== 0 ||
        !managedPoliciesAreExact)
    ) {
      issues.push(
        issue(
          'IAM_GRAPH_INVALID',
          'Reviewed roles must not embed inline policies or managed-policy ARNs outside the exact attachment graph.',
          role.address
        )
      );
    }
  }

  const expectedRoleNames = new Map(
    requiredRoles.map(([name]) => [
      `aws_iam_role_policy.${name}`,
      `statly-afl-trade-non-production-${name.replaceAll('_', '-')}`,
    ])
  );
  expectedRoleNames.set(
    'aws_iam_role_policy.capture_kms',
    'statly-afl-trade-non-production-capture'
  );
  const requiredInlinePolicies = [
    'aws_iam_role_policy.capture_kms',
    'aws_iam_role_policy.retention_admin',
    'aws_iam_role_policy.scheduler',
    'aws_iam_role_policy.task_execution',
  ];
  if (migrationAccessEnabled) requiredInlinePolicies.push('aws_iam_role_policy.migration');
  const invalidInlineEdge = requiredInlinePolicies.find((address) => {
    const policy = findByCanonicalAddress(changes, address);
    return policy === undefined || policy.after.role !== expectedRoleNames.get(address);
  });
  const invalidExclusiveAttachment = requiredRoles.find(([name]) => {
    const address = `aws_iam_role_policy_attachments_exclusive.${name}`;
    const attachment = findByAddress(changes, address);
    const expectedRoleName = `statly-afl-trade-non-production-${name.replaceAll('_', '-')}`;
    const roleIsExact =
      attachment?.after.role_name === expectedRoleName ||
      configurationExpressionReferences(
        configurationResources,
        address,
        'role_name',
        `aws_iam_role.${name}.name`
      );
    const policiesAreExact =
      name === 'capture'
        ? captureAttachmentPolicyIsExact
        : attachment !== undefined && exactRenderedStringSet(attachment.after.policy_arns, []);
    return attachment === undefined || !roleIsExact || !policiesAreExact;
  });
  const invalidExclusiveInlinePolicies = requiredRoles.find(([name]) => {
    const address = `aws_iam_role_policies_exclusive.${name}`;
    const attachment = findByAddress(changes, address);
    const expectedRoleName = `statly-afl-trade-non-production-${name.replaceAll('_', '-')}`;
    const roleIsExact =
      attachment?.after.role_name === expectedRoleName ||
      configurationExpressionReferences(
        configurationResources,
        address,
        'role_name',
        `aws_iam_role.${name}.name`
      );
    const expectedPolicyNames =
      name === 'capture'
        ? ['statly-afl-trade-non-production-capture-kms']
        : name === 'migration'
          ? migrationAccessEnabled
            ? ['statly-afl-trade-non-production-migration']
            : []
          : [`statly-afl-trade-non-production-${name.replaceAll('_', '-')}`];
    return (
      attachment === undefined ||
      !roleIsExact ||
      !exactRenderedStringSet(attachment.after.policy_names, expectedPolicyNames)
    );
  });
  if (
    invalidInlineEdge !== undefined ||
    invalidExclusiveAttachment !== undefined ||
    invalidExclusiveInlinePolicies !== undefined
  ) {
    issues.push(
      issue(
        'IAM_GRAPH_INVALID',
        'Every reviewed IAM policy must remain attached only to its exact role.',
        invalidInlineEdge ??
          (invalidExclusiveAttachment !== undefined
            ? `aws_iam_role_policy_attachments_exclusive.${invalidExclusiveAttachment[0]}`
            : `aws_iam_role_policies_exclusive.${invalidExclusiveInlinePolicies?.[0]}`)
      )
    );
  }

  const accountId = planVariable(plan, 'aws_account_id');
  const region = planVariable(plan, 'aws_region');
  const custodyBucketArnForIam = plannedArn(findByAddress(changes, 'aws_s3_bucket.custody'));
  const iamIdentitiesAreKnown =
    typeof accountId === 'string' && typeof region === 'string' && custodyBucketArnForIam !== null;
  const retentionPolicy = findByAddress(changes, 'aws_iam_role_policy.retention_admin');
  const schedulerPolicy = findByAddress(changes, 'aws_iam_role_policy.scheduler');
  const custodyKeyPattern = `arn:aws:kms:${region}:${accountId}:key/*`;
  const retentionExpected: readonly ExactPolicyStatement[] = [
    {
      sid: 'ReadAndDeleteExactCustodyVersions',
      effect: 'Allow',
      actions: [
        's3:DeleteObject',
        's3:DeleteObjectVersion',
        's3:GetObject',
        's3:GetObjectVersion',
      ].sort(),
      resources: [`${custodyBucketArnForIam}/*`],
    },
    {
      sid: 'UseCustodyKeyForReviewedWithdrawal',
      effect: 'Allow',
      actions: ['kms:Decrypt', 'kms:DescribeKey'].sort(),
      resources: [custodyKeyPattern],
      conditions: {
        'ForAnyValue:StringEquals': {
          'kms:ResourceAliases': ['alias/statly-afl-trade-non-production-custody'],
        },
      },
    },
  ];
  const schedulerExpected: readonly ExactPolicyStatement[] = [
    {
      sid: 'RunExactDispatcherTask',
      effect: 'Allow',
      actions: ['ecs:RunTask'],
      resources: [
        `arn:aws:ecs:${region}:${accountId}:task-definition/statly-afl-trade-non-production-external-dispatcher:*`,
      ],
      conditions: {
        ArnEquals: {
          'ecs:cluster': [
            `arn:aws:ecs:${region}:${accountId}:cluster/statly-afl-trade-non-production`,
          ],
        },
      },
    },
    {
      sid: 'PassExactDispatcherRoles',
      effect: 'Allow',
      actions: ['iam:PassRole'],
      resources: [
        `arn:aws:iam::${accountId}:role/statly-afl-trade-non-production-capture`,
        `arn:aws:iam::${accountId}:role/statly-afl-trade-non-production-task-execution`,
      ].sort(),
      conditions: {
        StringEquals: { 'iam:PassedToService': ['ecs-tasks.amazonaws.com'] },
      },
    },
  ];
  if (
    !iamIdentitiesAreKnown ||
    retentionPolicy === undefined ||
    schedulerPolicy === undefined ||
    !hasExactPolicyStatements(retentionPolicy.after.policy, retentionExpected) ||
    !hasExactPolicyStatements(schedulerPolicy.after.policy, schedulerExpected)
  ) {
    issues.push(
      issue(
        'IAM_GRAPH_INVALID',
        'Retention and scheduler roles must expose only their complete exact policy grants.'
      )
    );
  }

  const requiredFoundationSingletons = new Set([
    'terraform_data.configuration_attestation',
    'aws_db_instance.outcomes',
    'aws_db_parameter_group.outcomes',
    'aws_db_subnet_group.outcomes',
    'aws_elasticache_parameter_group.admission',
    'aws_elasticache_replication_group.admission',
    'aws_elasticache_subnet_group.admission',
    'aws_elasticache_user.capture',
    'aws_elasticache_user.default',
    'aws_elasticache_user_group.admission',
    'aws_iam_policy.capture',
    'aws_iam_role.capture',
    'aws_iam_role.migration',
    'aws_iam_role.retention_admin',
    'aws_iam_role.scheduler',
    'aws_iam_role.task_execution',
    'aws_iam_role_policy.capture_kms',
    'aws_iam_role_policy.retention_admin',
    'aws_iam_role_policy.scheduler',
    'aws_iam_role_policy.task_execution',
    'aws_iam_role_policy_attachments_exclusive.capture',
    'aws_iam_role_policy_attachments_exclusive.migration',
    'aws_iam_role_policy_attachments_exclusive.retention_admin',
    'aws_iam_role_policy_attachments_exclusive.scheduler',
    'aws_iam_role_policy_attachments_exclusive.task_execution',
    'aws_iam_role_policies_exclusive.capture',
    'aws_iam_role_policies_exclusive.migration',
    'aws_iam_role_policies_exclusive.retention_admin',
    'aws_iam_role_policies_exclusive.scheduler',
    'aws_iam_role_policies_exclusive.task_execution',
    'aws_kms_alias.cache',
    'aws_kms_alias.custody',
    'aws_kms_alias.database',
    'aws_kms_key.cache',
    'aws_kms_key.custody',
    'aws_kms_key.database',
    'aws_route_table.data',
    'aws_route_table.worker',
    'aws_s3_bucket.custody',
    'aws_s3_bucket.logging',
    'aws_s3_bucket_lifecycle_configuration.custody',
    'aws_s3_bucket_logging.custody',
    'aws_s3_bucket_ownership_controls.custody',
    'aws_s3_bucket_ownership_controls.logging',
    'aws_s3_bucket_policy.custody_safety',
    'aws_s3_bucket_policy.logging',
    'aws_s3_bucket_public_access_block.custody',
    'aws_s3_bucket_public_access_block.logging',
    'aws_s3_bucket_server_side_encryption_configuration.custody',
    'aws_s3_bucket_server_side_encryption_configuration.logging',
    'aws_s3_bucket_versioning.custody',
    'aws_s3_bucket_versioning.logging',
    'aws_secretsmanager_secret.runtime_database_url',
    'aws_security_group.cache',
    'aws_security_group.database',
    'aws_security_group.worker',
    'aws_vpc.outcomes',
    'aws_vpc_endpoint.s3',
    'aws_vpc_security_group_egress_rule.worker_cache',
    'aws_vpc_security_group_egress_rule.worker_database',
    'aws_vpc_security_group_egress_rule.worker_dns_tcp',
    'aws_vpc_security_group_egress_rule.worker_dns_udp',
    'aws_vpc_security_group_ingress_rule.cache_worker',
    'aws_vpc_security_group_ingress_rule.database_worker',
  ]);
  const regionForGraph = planVariable(plan, 'aws_region');
  const expectedForEachAddresses =
    typeof regionForGraph === 'string'
      ? new Set(
          ['a', 'b'].flatMap((suffix) => {
            const key = `${regionForGraph}${suffix}`;
            return [
              `aws_subnet.worker["${key}"]`,
              `aws_subnet.data["${key}"]`,
              `aws_route_table_association.worker["${key}"]`,
              `aws_route_table_association.data["${key}"]`,
            ];
          })
        )
      : new Set<string>();
  const managedChanges = changes.filter((change) => !change.address.startsWith('data.'));
  const exactFoundationAddresses = new Set([
    ...requiredFoundationSingletons,
    ...expectedForEachAddresses,
    ...(migrationAccessEnabled ? ['aws_iam_role_policy.migration[0]'] : []),
  ]);
  const singletonCardinalityIsExact = [...requiredFoundationSingletons].every(
    (address) => managedChanges.filter((change) => change.address === address).length === 1
  );
  const foundationGraphIsExact =
    typeof regionForGraph === 'string' &&
    singletonCardinalityIsExact &&
    managedChanges.length === exactFoundationAddresses.size &&
    managedChanges.every((change) => exactFoundationAddresses.has(change.address));
  if (!foundationGraphIsExact) {
    issues.push(
      issue(
        'FOUNDATION_GRAPH_INVALID',
        'The plan must contain every reviewed foundation resource exactly once, with only the approved keyed instances.'
      )
    );
  }

  const approvedFoundationAddresses = new Set([
    'terraform_data.configuration_attestation',
    'aws_db_instance.outcomes',
    'aws_db_parameter_group.outcomes',
    'aws_db_subnet_group.outcomes',
    'aws_elasticache_parameter_group.admission',
    'aws_elasticache_replication_group.admission',
    'aws_elasticache_subnet_group.admission',
    'aws_elasticache_user.capture',
    'aws_elasticache_user.default',
    'aws_elasticache_user_group.admission',
    'aws_iam_policy.capture',
    'aws_iam_role.capture',
    'aws_iam_role.migration',
    'aws_iam_role.retention_admin',
    'aws_iam_role.scheduler',
    'aws_iam_role.task_execution',
    'aws_iam_role_policy.capture_kms',
    'aws_iam_role_policy.migration',
    'aws_iam_role_policy.retention_admin',
    'aws_iam_role_policy.scheduler',
    'aws_iam_role_policy.task_execution',
    'aws_iam_role_policy_attachments_exclusive.capture',
    'aws_iam_role_policy_attachments_exclusive.migration',
    'aws_iam_role_policy_attachments_exclusive.retention_admin',
    'aws_iam_role_policy_attachments_exclusive.scheduler',
    'aws_iam_role_policy_attachments_exclusive.task_execution',
    'aws_iam_role_policies_exclusive.capture',
    'aws_iam_role_policies_exclusive.migration',
    'aws_iam_role_policies_exclusive.retention_admin',
    'aws_iam_role_policies_exclusive.scheduler',
    'aws_iam_role_policies_exclusive.task_execution',
    'aws_kms_alias.cache',
    'aws_kms_alias.custody',
    'aws_kms_alias.database',
    'aws_kms_key.cache',
    'aws_kms_key.custody',
    'aws_kms_key.database',
    'aws_route_table.data',
    'aws_route_table.worker',
    'aws_route_table_association.data',
    'aws_route_table_association.worker',
    'aws_s3_bucket.custody',
    'aws_s3_bucket.logging',
    'aws_s3_bucket_lifecycle_configuration.custody',
    'aws_s3_bucket_logging.custody',
    'aws_s3_bucket_ownership_controls.custody',
    'aws_s3_bucket_ownership_controls.logging',
    'aws_s3_bucket_policy.custody_safety',
    'aws_s3_bucket_policy.logging',
    'aws_s3_bucket_public_access_block.custody',
    'aws_s3_bucket_public_access_block.logging',
    'aws_s3_bucket_server_side_encryption_configuration.custody',
    'aws_s3_bucket_server_side_encryption_configuration.logging',
    'aws_s3_bucket_versioning.custody',
    'aws_s3_bucket_versioning.logging',
    'aws_secretsmanager_secret.runtime_database_url',
    'aws_security_group.cache',
    'aws_security_group.database',
    'aws_security_group.worker',
    'aws_subnet.data',
    'aws_subnet.worker',
    'aws_vpc.outcomes',
    'aws_vpc_endpoint.s3',
    'aws_vpc_security_group_egress_rule.worker_cache',
    'aws_vpc_security_group_egress_rule.worker_database',
    'aws_vpc_security_group_egress_rule.worker_dns_tcp',
    'aws_vpc_security_group_egress_rule.worker_dns_udp',
    'aws_vpc_security_group_ingress_rule.cache_worker',
    'aws_vpc_security_group_ingress_rule.database_worker',
    'data.aws_iam_policy_document.capture',
    'data.aws_iam_policy_document.capture_kms',
    'data.aws_iam_policy_document.custody_safety',
    'data.aws_iam_policy_document.ecs_tasks_assume_role',
    'data.aws_iam_policy_document.logging_bucket',
    'data.aws_iam_policy_document.migration',
    'data.aws_iam_policy_document.retention_admin',
    'data.aws_iam_policy_document.scheduler',
    'data.aws_iam_policy_document.scheduler_assume_role',
    'data.aws_iam_policy_document.task_execution',
  ]);
  const unapprovedResources = changes.filter(
    (change) => !approvedFoundationAddresses.has(canonicalAddress(change.address))
  );
  const unapprovedNetwork = unapprovedResources.find((change) =>
    [
      'aws_security_group',
      'aws_security_group_rule',
      'aws_vpc_security_group_egress_rule',
      'aws_vpc_security_group_ingress_rule',
      'aws_route',
      'aws_route_table',
      'aws_internet_gateway',
      'aws_nat_gateway',
      'aws_egress_only_internet_gateway',
      'aws_ec2_transit_gateway',
      'aws_vpc_peering_connection',
    ].includes(change.type)
  );
  if (unapprovedNetwork !== undefined) {
    issues.push(
      issue(
        'WORKER_INTERNET_EGRESS_OPEN',
        'The foundation contains a network path outside the exact reviewed resource graph.',
        unapprovedNetwork.address
      )
    );
  }
  const unapprovedNonNetwork = unapprovedResources.find((change) => change !== unapprovedNetwork);
  if (unapprovedNonNetwork !== undefined) {
    issues.push(
      issue(
        'UNAPPROVED_COMPUTE',
        'The foundation contains an AWS resource outside the exact reviewed definition-only graph.',
        unapprovedNonNetwork.address
      )
    );
  }

  const workerSecurityGroup = findByAddress(changes, 'aws_security_group.worker');
  const databaseSecurityGroup = findByAddress(changes, 'aws_security_group.database');
  const cacheSecurityGroup = findByAddress(changes, 'aws_security_group.cache');
  const databaseSubnetGroup = findByAddress(changes, 'aws_db_subnet_group.outcomes');
  const cacheSubnetGroup = findByAddress(changes, 'aws_elasticache_subnet_group.admission');
  const outcomesVpc = findByAddress(changes, 'aws_vpc.outcomes');
  const workerRouteTable = findByAddress(changes, 'aws_route_table.worker');
  const dataRouteTable = findByAddress(changes, 'aws_route_table.data');
  const s3Endpoint = findByAddress(changes, 'aws_vpc_endpoint.s3');
  const knownOrAttestedString = (
    change: PlanResourceChange | undefined,
    property: string,
    expected: string | null
  ): boolean => {
    const value = change?.after[property];
    if (typeof value === 'string') return expected !== null && value === expected;
    return (
      change !== undefined &&
      configurationIsAttested &&
      hasUnknownProperty(change.afterUnknown, property)
    );
  };
  const knownOrAttestedStringSet = (
    change: PlanResourceChange | undefined,
    property: string,
    expected: readonly string[]
  ): boolean => {
    const value = change?.after[property];
    if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
      return exactStringSet(value, expected);
    }
    return (
      change !== undefined &&
      configurationIsAttested &&
      hasUnknownProperty(change.afterUnknown, property)
    );
  };
  const outcomesVpcId = typeof outcomesVpc?.after.id === 'string' ? outcomesVpc.after.id : null;
  const workerRouteTableId =
    typeof workerRouteTable?.after.id === 'string' ? workerRouteTable.after.id : null;
  const dataRouteTableId =
    typeof dataRouteTable?.after.id === 'string' ? dataRouteTable.after.id : null;
  const topologyRegion = planVariable(plan, 'aws_region');
  const topologyZones =
    typeof topologyRegion === 'string'
      ? [`${topologyRegion}a`, `${topologyRegion}b`]
      : ([] as string[]);
  const workerSubnets = topologyZones.map((zone) =>
    findByAddress(changes, `aws_subnet.worker["${zone}"]`)
  );
  const dataSubnets = topologyZones.map((zone) =>
    findByAddress(changes, `aws_subnet.data["${zone}"]`)
  );
  const workerSubnetIds = workerSubnets.flatMap((subnet) =>
    typeof subnet?.after.id === 'string' ? [subnet.after.id] : []
  );
  const dataSubnetIds = dataSubnets.flatMap((subnet) =>
    typeof subnet?.after.id === 'string' ? [subnet.after.id] : []
  );
  const subnetIsExact = (
    subnet: PlanResourceChange | undefined,
    zone: string,
    expectedCidr: string
  ): boolean =>
    subnet !== undefined &&
    subnet.after.availability_zone === zone &&
    subnet.after.cidr_block === expectedCidr &&
    subnet.after.map_public_ip_on_launch === false &&
    knownOrAttestedString(subnet, 'vpc_id', outcomesVpcId);
  const routeAssociationIsExact = (
    tier: 'worker' | 'data',
    zone: string,
    expectedRouteTableId: string | null,
    expectedSubnetId: string | null
  ): boolean => {
    const association = findByAddress(changes, `aws_route_table_association.${tier}["${zone}"]`);
    return (
      knownOrAttestedString(association, 'route_table_id', expectedRouteTableId) &&
      knownOrAttestedString(association, 'subnet_id', expectedSubnetId)
    );
  };
  const routeTablesHaveNoInlineRoutes = [workerRouteTable, dataRouteTable].every(
    (routeTable) =>
      routeTable !== undefined &&
      Array.isArray(routeTable.after.route) &&
      routeTable.after.route.length === 0
  );
  const topologyIsExact =
    configurationIsAttested &&
    topologyZones.length === 2 &&
    outcomesVpc?.after.cidr_block === '10.64.0.0/16' &&
    outcomesVpc.after.enable_dns_hostnames === true &&
    outcomesVpc.after.enable_dns_support === true &&
    workerSubnets.every((subnet, index) =>
      subnetIsExact(subnet, topologyZones[index]!, `10.64.${16 + index}.0/24`)
    ) &&
    dataSubnets.every((subnet, index) =>
      subnetIsExact(subnet, topologyZones[index]!, `10.64.${32 + index}.0/24`)
    ) &&
    routeTablesHaveNoInlineRoutes &&
    knownOrAttestedString(workerRouteTable, 'vpc_id', outcomesVpcId) &&
    knownOrAttestedString(dataRouteTable, 'vpc_id', outcomesVpcId) &&
    topologyZones.every((zone, index) =>
      routeAssociationIsExact(
        'worker',
        zone,
        workerRouteTableId,
        typeof workerSubnets[index]?.after.id === 'string'
          ? (workerSubnets[index]?.after.id as string)
          : null
      )
    ) &&
    topologyZones.every((zone, index) =>
      routeAssociationIsExact(
        'data',
        zone,
        dataRouteTableId,
        typeof dataSubnets[index]?.after.id === 'string'
          ? (dataSubnets[index]?.after.id as string)
          : null
      )
    ) &&
    knownOrAttestedString(s3Endpoint, 'vpc_id', outcomesVpcId) &&
    knownOrAttestedStringSet(
      s3Endpoint,
      'route_table_ids',
      workerRouteTableId === null ? [] : [workerRouteTableId]
    ) &&
    s3Endpoint?.after.service_name === `com.amazonaws.${topologyRegion}.s3` &&
    s3Endpoint.after.vpc_endpoint_type === 'Gateway' &&
    [workerSecurityGroup, databaseSecurityGroup, cacheSecurityGroup].every((securityGroup) =>
      knownOrAttestedString(securityGroup, 'vpc_id', outcomesVpcId)
    ) &&
    knownOrAttestedStringSet(databaseSubnetGroup, 'subnet_ids', dataSubnetIds) &&
    knownOrAttestedStringSet(cacheSubnetGroup, 'subnet_ids', dataSubnetIds) &&
    (dataSubnetIds.length === 0 || dataSubnetIds.length === 2) &&
    (workerSubnetIds.length === 0 || workerSubnetIds.length === 2);
  if (!topologyIsExact) {
    issues.push(
      issue(
        'NETWORK_BOUNDARY_INVALID',
        'The VPC, private subnets, route tables without inline routes, S3 endpoint, security groups and data subnet groups must remain one exact isolated graph.'
      )
    );
  }
  const expectedResolverCidr = resolverCidr(planVariable(plan, 'vpc_cidr'));
  const exactSecurityGroupRule = (input: {
    address: string;
    port: number;
    protocol: string;
    cidr?: string;
    targetGroupId?: unknown;
    targetGroupAddress: string;
    referencedGroupId?: unknown;
    referencedGroupAddress?: string;
  }): boolean => {
    const rule = findByAddress(changes, input.address);
    if (rule === undefined) return false;
    const targetIsExact =
      (typeof input.targetGroupId === 'string' &&
        rule.after.security_group_id === input.targetGroupId) ||
      configurationExpressionReferences(
        configurationResources,
        rule.address,
        'security_group_id',
        input.targetGroupAddress
      );
    const referencedTargetIsExact =
      input.referencedGroupAddress === undefined
        ? rule.after.referenced_security_group_id === null ||
          rule.after.referenced_security_group_id === undefined
        : (typeof input.referencedGroupId === 'string' &&
            rule.after.referenced_security_group_id === input.referencedGroupId) ||
          configurationExpressionReferences(
            configurationResources,
            rule.address,
            'referenced_security_group_id',
            input.referencedGroupAddress
          );
    return (
      targetIsExact &&
      referencedTargetIsExact &&
      rule.after.from_port === input.port &&
      rule.after.to_port === input.port &&
      rule.after.ip_protocol === input.protocol &&
      (input.cidr === undefined
        ? rule.after.cidr_ipv4 === null || rule.after.cidr_ipv4 === undefined
        : rule.after.cidr_ipv4 === input.cidr) &&
      (rule.after.cidr_ipv6 === null || rule.after.cidr_ipv6 === undefined) &&
      (rule.after.prefix_list_id === null || rule.after.prefix_list_id === undefined)
    );
  };
  const workerRulesAreExact =
    expectedResolverCidr !== null &&
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_egress_rule.worker_dns_udp',
      port: 53,
      protocol: 'udp',
      cidr: expectedResolverCidr,
      targetGroupId: workerSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.worker.id',
    }) &&
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_egress_rule.worker_dns_tcp',
      port: 53,
      protocol: 'tcp',
      cidr: expectedResolverCidr,
      targetGroupId: workerSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.worker.id',
    }) &&
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_egress_rule.worker_database',
      port: 5432,
      protocol: 'tcp',
      targetGroupId: workerSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.worker.id',
      referencedGroupId: databaseSecurityGroup?.after.id,
      referencedGroupAddress: 'aws_security_group.database.id',
    }) &&
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_egress_rule.worker_cache',
      port: 6379,
      protocol: 'tcp',
      targetGroupId: workerSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.worker.id',
      referencedGroupId: cacheSecurityGroup?.after.id,
      referencedGroupAddress: 'aws_security_group.cache.id',
    }) &&
    workerSecurityGroup !== undefined &&
    (!Array.isArray(workerSecurityGroup.after.egress) ||
      workerSecurityGroup.after.egress.length === 0);
  if (!workerRulesAreExact) {
    issues.push(
      issue(
        'WORKER_INTERNET_EGRESS_OPEN',
        'Worker egress must match the exact DNS, database and cache-only rule set.'
      )
    );
  }

  const databaseAndCacheIngressAreExact =
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_ingress_rule.database_worker',
      port: 5432,
      protocol: 'tcp',
      targetGroupId: databaseSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.database.id',
      referencedGroupId: workerSecurityGroup?.after.id,
      referencedGroupAddress: 'aws_security_group.worker.id',
    }) &&
    exactSecurityGroupRule({
      address: 'aws_vpc_security_group_ingress_rule.cache_worker',
      port: 6379,
      protocol: 'tcp',
      targetGroupId: cacheSecurityGroup?.after.id,
      targetGroupAddress: 'aws_security_group.cache.id',
      referencedGroupId: workerSecurityGroup?.after.id,
      referencedGroupAddress: 'aws_security_group.worker.id',
    });
  const databaseSecurityGroupId =
    typeof databaseSecurityGroup?.after.id === 'string' ? databaseSecurityGroup.after.id : null;
  const cacheSecurityGroupId =
    typeof cacheSecurityGroup?.after.id === 'string' ? cacheSecurityGroup.after.id : null;
  const databaseSubnetGroupName =
    typeof databaseSubnetGroup?.after.name === 'string' ? databaseSubnetGroup.after.name : null;
  const cacheSubnetGroupName =
    typeof cacheSubnetGroup?.after.name === 'string' ? cacheSubnetGroup.after.name : null;
  const serviceBindingsAreExact =
    plannedStringSetMatchesExactResources(
      database,
      configurationResources,
      'vpc_security_group_ids',
      databaseSecurityGroupId === null ? [] : [databaseSecurityGroupId],
      ['aws_security_group.database.id']
    ) &&
    plannedStringMatchesExactResource(
      database,
      configurationResources,
      'db_subnet_group_name',
      databaseSubnetGroupName,
      'aws_db_subnet_group.outcomes.name'
    ) &&
    plannedStringSetMatchesExactResources(
      cache,
      configurationResources,
      'security_group_ids',
      cacheSecurityGroupId === null ? [] : [cacheSecurityGroupId],
      ['aws_security_group.cache.id']
    ) &&
    plannedStringMatchesExactResource(
      cache,
      configurationResources,
      'subnet_group_name',
      cacheSubnetGroupName,
      'aws_elasticache_subnet_group.admission.name'
    );
  const securityGroupsHaveNoInlineRules = [
    workerSecurityGroup,
    databaseSecurityGroup,
    cacheSecurityGroup,
  ].every(
    (securityGroup) =>
      securityGroup !== undefined &&
      Array.isArray(securityGroup.after.ingress) &&
      securityGroup.after.ingress.length === 0 &&
      Array.isArray(securityGroup.after.egress) &&
      securityGroup.after.egress.length === 0
  );
  if (
    !databaseAndCacheIngressAreExact ||
    !serviceBindingsAreExact ||
    !securityGroupsHaveNoInlineRules
  ) {
    issues.push(
      issue(
        'NETWORK_BOUNDARY_INVALID',
        'Database and cache network and subnet bindings must remain on the exact reviewed groups, with no inline security-group rules.'
      )
    );
  }

  const workerIpv4Cidrs: string[] = [];
  const workerIpv6Cidrs: string[] = [];
  let internetPathExists = false;
  for (const change of changes) {
    const address = canonicalAddress(change.address);
    if (change.type === 'aws_internet_gateway' || change.type === 'aws_nat_gateway') {
      internetPathExists = true;
    }
    if (
      (change.type === 'aws_route' || change.type === 'aws_route_table') &&
      (change.after.destination_cidr_block === '0.0.0.0/0' ||
        change.after.destination_ipv6_cidr_block === '::/0' ||
        (Array.isArray(change.after.route) &&
          change.after.route.some(
            (rawRoute) =>
              typeof rawRoute === 'object' &&
              rawRoute !== null &&
              ((rawRoute as { cidr_block?: unknown }).cidr_block === '0.0.0.0/0' ||
                (rawRoute as { ipv6_cidr_block?: unknown }).ipv6_cidr_block === '::/0')
          )))
    ) {
      internetPathExists = true;
    }
    if (
      change.type === 'aws_vpc_security_group_egress_rule' &&
      address.startsWith('aws_vpc_security_group_egress_rule.worker_')
    ) {
      if (typeof change.after.cidr_ipv4 === 'string') {
        workerIpv4Cidrs.push(change.after.cidr_ipv4);
      }
      if (typeof change.after.cidr_ipv6 === 'string') {
        workerIpv6Cidrs.push(change.after.cidr_ipv6);
      }
    }
    if (
      change.type === 'aws_security_group_rule' &&
      address.startsWith('aws_security_group_rule.worker_') &&
      change.after.type === 'egress'
    ) {
      workerIpv4Cidrs.push(...stringValues(change.after.cidr_blocks));
      workerIpv6Cidrs.push(...stringValues(change.after.ipv6_cidr_blocks));
    }
    if (change.type === 'aws_security_group' && address === 'aws_security_group.worker') {
      const cidrs = inlineCidrs(change.after);
      workerIpv4Cidrs.push(...cidrs.ipv4);
      workerIpv6Cidrs.push(...cidrs.ipv6);
    }
  }
  if (internetPathExists || coversAllIpv4(workerIpv4Cidrs) || workerIpv6Cidrs.includes('::/0')) {
    issues.push(
      issue(
        'WORKER_INTERNET_EGRESS_OPEN',
        'The non-production foundation must not expose unrestricted worker internet egress.'
      )
    );
  }

  const schedules = changes.filter((change) => change.type === 'aws_scheduler_schedule');
  const alarms = changes.filter((change) => change.type === 'aws_cloudwatch_metric_alarm');
  const computeTypes = new Set([
    'aws_batch_job_definition',
    'aws_ecs_service',
    'aws_ecs_task_definition',
    'aws_lambda_function',
  ]);
  const compute = changes.filter((change) => computeTypes.has(change.type));
  const unapprovedCompute = compute.find(
    (change) => canonicalAddress(change.address) !== 'aws_ecs_task_definition.external_dispatcher'
  );
  if (unapprovedCompute !== undefined) {
    issues.push(
      issue(
        'UNAPPROVED_COMPUTE',
        'Only the reviewed external dispatcher task definition may enter this infrastructure plan.',
        unapprovedCompute.address
      )
    );
  }
  const schedule = schedules.find(
    (change) => canonicalAddress(change.address) === 'aws_scheduler_schedule.external_capture'
  );
  const alarm = alarms.find(
    (change) => canonicalAddress(change.address) === 'aws_cloudwatch_metric_alarm.dispatcher_failed'
  );
  const computeBoundaryExists = compute.length > 0 || schedules.length > 0 || alarms.length > 0;
  if (computeBoundaryExists && schedule === undefined) {
    issues.push(
      issue('CAPTURE_SCHEDULE_MISSING', 'The bounded external-capture schedule is missing.')
    );
  }
  const invalidSchedule = schedules.find(
    (candidate) =>
      canonicalAddress(candidate.address) !== 'aws_scheduler_schedule.external_capture' ||
      candidate.after.state !== 'DISABLED'
  );
  if (invalidSchedule !== undefined) {
    issues.push(
      issue(
        'CAPTURE_SCHEDULE_ENABLED',
        'Only the reviewed disabled Stage 2A capture schedule may exist before activation.',
        invalidSchedule.address
      )
    );
  }

  if (computeBoundaryExists && alarm === undefined) {
    issues.push(
      issue('DISPATCH_FAILURE_ALARM_MISSING', 'The dispatcher failure alarm is missing.')
    );
  }

  return issues;
}
