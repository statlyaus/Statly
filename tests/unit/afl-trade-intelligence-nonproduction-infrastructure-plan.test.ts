import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { validateAflTradeNonproductionPlan as validateRawAflTradeNonproductionPlan } from '../../Scripts/infra/afl-trade-nonproduction-plan-policy';
import {
  computeAflTradeNonproductionConfigurationSourceDigest,
  runAflTradeNonproductionPlanValidationCommand,
} from '../../Scripts/infra/validate-afl-trade-nonproduction-plan';

const configurationSourceDigest =
  'ffec293651eef664d144616999bfbe8c9482c3726e769b9004e5649c6a04993e';
const bucketStem = 'statly-afl-trade-np-111122223333-ap-southeast-2';
const custodyBucketName = `${bucketStem}-custody`;
const loggingBucketName = `${bucketStem}-logs`;
const custodyBucketArn = `arn:aws:s3:::${custodyBucketName}`;
const loggingBucketArn = `arn:aws:s3:::${loggingBucketName}`;
const custodyKeyArn = 'arn:aws:kms:ap-southeast-2:111122223333:key/custody';
const s3PrefixListId = 'pl-s3';
const cacheReplicationArn =
  'arn:aws:elasticache:ap-southeast-2:111122223333:replicationgroup:statly-afl-trade-non-production-admission';
const cacheUserArn =
  'arn:aws:elasticache:ap-southeast-2:111122223333:user:statly-afl-trade-non-production-capture';
const runtimeSecretArn =
  'arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:runtime-database-url';
const migrationSecretArn =
  'arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:migration-database-url-AbCdEf';
const runtimeSecretPattern =
  'arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:/statly/afl-trade/non_production/outcomes-runtime-database-url-*';
const databaseKeyArn = 'arn:aws:kms:ap-southeast-2:111122223333:key/database';
const databaseKeyPattern = 'arn:aws:kms:ap-southeast-2:111122223333:key/*';
const custodyKeyPattern = 'arn:aws:kms:ap-southeast-2:111122223333:key/*';
const custodyKeyAlias = 'alias/statly-afl-trade-non-production-custody';
const databaseKeyAlias = 'alias/statly-afl-trade-non-production-database';
const captureRoleArn = 'arn:aws:iam::111122223333:role/statly-afl-trade-non-production-capture';
const retentionRoleArn =
  'arn:aws:iam::111122223333:role/statly-afl-trade-non-production-retention-admin';
const roleName = (name: string) => `statly-afl-trade-non-production-${name}`;
const boundedPlanArgv = [
  '--aws-account-id',
  '111122223333',
  '--capture-retention-days',
  '365',
] as const;
const validateAflTradeNonproductionPlan = (plan: unknown) =>
  validateRawAflTradeNonproductionPlan(plan, { configurationSourceDigest });
const canonicalPlanAddress = (address: unknown) =>
  typeof address === 'string' ? address.replace(/\[[^\]]+\]/g, '') : '';
const ecsTrustPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: { Service: 'ecs-tasks.amazonaws.com' },
    },
  ],
});
const schedulerTrustPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: { Service: 'scheduler.amazonaws.com' },
    },
  ],
});

function custodySafetyPolicy(): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'RequireTls',
        Action: 's3:*',
        Effect: 'Deny',
        Resource: [custodyBucketArn, `${custodyBucketArn}/*`],
        Principal: { AWS: '*' },
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
      {
        Sid: 'RequireConditionalCreation',
        Action: 's3:PutObject',
        Effect: 'Deny',
        Resource: `${custodyBucketArn}/*`,
        Principal: { AWS: '*' },
        Condition: { Null: { 's3:if-none-match': 'true' } },
      },
      {
        Sid: 'RequireKmsEncryption',
        Action: 's3:PutObject',
        Effect: 'Deny',
        Resource: `${custodyBucketArn}/*`,
        Principal: { AWS: '*' },
        Condition: {
          StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' },
        },
      },
      {
        Sid: 'RequireCustodyKmsKey',
        Action: 's3:PutObject',
        Effect: 'Deny',
        Resource: `${custodyBucketArn}/*`,
        Principal: { AWS: '*' },
        Condition: {
          ArnNotEqualsIfExists: {
            's3:x-amz-server-side-encryption-aws-kms-key-id': custodyKeyArn,
          },
        },
      },
      {
        Sid: 'DenyUnreviewedDeletion',
        Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
        Effect: 'Deny',
        Resource: `${custodyBucketArn}/*`,
        Principal: { AWS: '*' },
        Condition: { ArnNotEquals: { 'aws:PrincipalArn': retentionRoleArn } },
      },
    ],
  });
}

function loggingSafetyPolicy(): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'RequireTls',
        Action: 's3:*',
        Effect: 'Deny',
        Resource: [loggingBucketArn, `${loggingBucketArn}/*`],
        Principal: { AWS: '*' },
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
      {
        Sid: 'PermitS3AccessLogDelivery',
        Action: 's3:PutObject',
        Effect: 'Allow',
        Resource: `${loggingBucketArn}/access/*`,
        Principal: { Service: 'logging.s3.amazonaws.com' },
        Condition: {
          ArnLike: { 'aws:SourceArn': custodyBucketArn },
          StringEquals: { 'aws:SourceAccount': '111122223333' },
        },
      },
    ],
  });
}

function kmsPolicy(actions: readonly string[], alias: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: actions,
        Resource: alias === custodyKeyAlias ? custodyKeyPattern : databaseKeyPattern,
        Condition: { 'ForAnyValue:StringEquals': { 'kms:ResourceAliases': alias } },
      },
    ],
  });
}

function resource(
  address: string,
  type: string,
  after: Readonly<Record<string, unknown>>,
  afterUnknown: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    address,
    mode: 'managed',
    type,
    change: {
      actions: ['create'],
      after,
      after_unknown: afterUnknown,
    },
  };
}

function foundationPresenceResources(): readonly Readonly<Record<string, unknown>>[] {
  const zones = ['ap-southeast-2a', 'ap-southeast-2b'] as const;
  const workerSubnetIds = ['subnet-worker-a', 'subnet-worker-b'];
  const dataSubnetIds = ['subnet-data-a', 'subnet-data-b'];
  return [
    resource('terraform_data.configuration_attestation', 'terraform_data', {
      input: configurationSourceDigest,
    }),
    resource('aws_vpc.outcomes', 'aws_vpc', {
      cidr_block: '10.64.0.0/16',
      enable_dns_hostnames: true,
      enable_dns_support: true,
      id: 'vpc-outcomes',
    }),
    ...zones.map((zone, index) =>
      resource(`aws_subnet.worker["${zone}"]`, 'aws_subnet', {
        availability_zone: zone,
        cidr_block: `10.64.${16 + index}.0/24`,
        id: workerSubnetIds[index],
        map_public_ip_on_launch: false,
        vpc_id: 'vpc-outcomes',
      })
    ),
    ...zones.map((zone, index) =>
      resource(`aws_subnet.data["${zone}"]`, 'aws_subnet', {
        availability_zone: zone,
        cidr_block: `10.64.${32 + index}.0/24`,
        id: dataSubnetIds[index],
        map_public_ip_on_launch: false,
        vpc_id: 'vpc-outcomes',
      })
    ),
    resource('aws_route_table.worker', 'aws_route_table', {
      id: 'rt-worker',
      route: [],
      vpc_id: 'vpc-outcomes',
    }),
    ...zones.map((zone, index) =>
      resource(`aws_route_table_association.worker["${zone}"]`, 'aws_route_table_association', {
        route_table_id: 'rt-worker',
        subnet_id: workerSubnetIds[index],
      })
    ),
    resource('aws_route_table.data', 'aws_route_table', {
      id: 'rt-data',
      route: [],
      vpc_id: 'vpc-outcomes',
    }),
    ...zones.map((zone, index) =>
      resource(`aws_route_table_association.data["${zone}"]`, 'aws_route_table_association', {
        route_table_id: 'rt-data',
        subnet_id: dataSubnetIds[index],
      })
    ),
    resource('aws_vpc_endpoint.s3', 'aws_vpc_endpoint', {
      route_table_ids: ['rt-worker'],
      service_name: 'com.amazonaws.ap-southeast-2.s3',
      vpc_endpoint_type: 'Gateway',
      vpc_id: 'vpc-outcomes',
    }),
    resource('aws_vpc_security_group_egress_rule.worker_s3', 'aws_vpc_security_group_egress_rule', {
      from_port: 443,
      ip_protocol: 'tcp',
      prefix_list_id: s3PrefixListId,
      security_group_id: 'sg-worker',
      to_port: 443,
    }),
    resource('data.aws_prefix_list.s3', 'aws_prefix_list', {
      id: s3PrefixListId,
      name: 'com.amazonaws.ap-southeast-2.s3',
    }),
    resource('aws_kms_alias.database', 'aws_kms_alias', {}),
    resource('aws_db_subnet_group.outcomes', 'aws_db_subnet_group', {
      name: roleName('database'),
      subnet_ids: dataSubnetIds,
    }),
    resource('aws_db_parameter_group.outcomes', 'aws_db_parameter_group', {}),
    resource('aws_kms_key.cache', 'aws_kms_key', {}),
    resource('aws_kms_alias.cache', 'aws_kms_alias', {}),
    resource('aws_elasticache_subnet_group.admission', 'aws_elasticache_subnet_group', {
      name: roleName('cache'),
      subnet_ids: dataSubnetIds,
    }),
    resource('aws_elasticache_parameter_group.admission', 'aws_elasticache_parameter_group', {}),
    resource('aws_elasticache_user.default', 'aws_elasticache_user', {}),
    resource('aws_elasticache_user_group.admission', 'aws_elasticache_user_group', {}),
    resource('aws_kms_alias.custody', 'aws_kms_alias', {}),
    resource('aws_s3_bucket.logging', 'aws_s3_bucket', {
      arn: loggingBucketArn,
      bucket: loggingBucketName,
      id: loggingBucketName,
    }),
    resource('aws_s3_bucket_ownership_controls.logging', 'aws_s3_bucket_ownership_controls', {
      bucket: loggingBucketName,
      rule: [{ object_ownership: 'BucketOwnerEnforced' }],
    }),
    resource('aws_s3_bucket_public_access_block.logging', 'aws_s3_bucket_public_access_block', {
      block_public_acls: true,
      block_public_policy: true,
      bucket: loggingBucketName,
      ignore_public_acls: true,
      restrict_public_buckets: true,
    }),
    resource(
      'aws_s3_bucket_server_side_encryption_configuration.logging',
      'aws_s3_bucket_server_side_encryption_configuration',
      {
        bucket: loggingBucketName,
        rule: [
          {
            apply_server_side_encryption_by_default: [{ sse_algorithm: 'AES256' }],
          },
        ],
      }
    ),
    resource('aws_s3_bucket_versioning.logging', 'aws_s3_bucket_versioning', {
      bucket: loggingBucketName,
      versioning_configuration: [{ status: 'Enabled' }],
    }),
    resource(
      'aws_s3_bucket_lifecycle_configuration.logging',
      'aws_s3_bucket_lifecycle_configuration',
      {
        bucket: loggingBucketName,
        rule: [
          {
            expiration: [{ days: 364 }],
            filter: [{ prefix: 'access/' }],
            id: 'expire-access-logs-at-approved-maximum-age',
            noncurrent_version_expiration: [{ noncurrent_days: 1 }],
            status: 'Enabled',
          },
          {
            abort_incomplete_multipart_upload: [{ days_after_initiation: 7 }],
            filter: [],
            id: 'abort-incomplete-multipart-uploads',
            status: 'Enabled',
          },
        ],
      }
    ),
    resource('aws_s3_bucket_policy.logging', 'aws_s3_bucket_policy', {
      bucket: loggingBucketName,
      policy: loggingSafetyPolicy(),
    }),
    resource('aws_s3_bucket_ownership_controls.custody', 'aws_s3_bucket_ownership_controls', {
      bucket: custodyBucketName,
      rule: [{ object_ownership: 'BucketOwnerEnforced' }],
    }),
    resource('aws_s3_bucket_logging.custody', 'aws_s3_bucket_logging', {
      bucket: custodyBucketName,
      target_bucket: loggingBucketName,
      target_prefix: 'access/',
    }),
    resource(
      'aws_vpc_security_group_ingress_rule.database_worker',
      'aws_vpc_security_group_ingress_rule',
      {
        from_port: 5432,
        ip_protocol: 'tcp',
        referenced_security_group_id: 'sg-worker',
        security_group_id: 'sg-database',
        to_port: 5432,
      }
    ),
    resource(
      'aws_vpc_security_group_ingress_rule.cache_worker',
      'aws_vpc_security_group_ingress_rule',
      {
        from_port: 6379,
        ip_protocol: 'tcp',
        referenced_security_group_id: 'sg-worker',
        security_group_id: 'sg-cache',
        to_port: 6379,
      }
    ),
  ];
}

function configurationResource(
  address: string,
  type: string,
  expressions: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return { address, mode: address.startsWith('data.') ? 'data' : 'managed', type, expressions };
}

function planConfiguration(): Readonly<Record<string, unknown>> {
  const deterministicBucketExpression = { references: ['local.bucket_stem'] };
  const statement = (
    actions: readonly string[],
    resourceReferences: readonly string[]
  ): Readonly<Record<string, unknown>> => ({
    actions: { constant_value: actions },
    effect: { constant_value: 'Allow' },
    resources: { references: resourceReferences },
  });
  const securityGroupRule = (
    address: string,
    target: string,
    referenced?: string
  ): Readonly<Record<string, unknown>> =>
    configurationResource(address, address.split('.')[0], {
      security_group_id: { references: [target] },
      ...(referenced === undefined
        ? {}
        : { referenced_security_group_id: { references: [referenced] } }),
    });

  return {
    root_module: {
      resources: [
        configurationResource('aws_s3_bucket_policy.custody_safety', 'aws_s3_bucket_policy', {
          bucket: deterministicBucketExpression,
          policy: { references: ['data.aws_iam_policy_document.custody_safety.json'] },
        }),
        configurationResource(
          'data.aws_iam_policy_document.custody_safety',
          'aws_iam_policy_document',
          {
            statement: [
              'RequireTls',
              'RequireConditionalCreation',
              'RequireKmsEncryption',
              'RequireCustodyKmsKey',
              'DenyUnreviewedDeletion',
            ].map((sid) => ({ sid: { constant_value: sid } })),
          }
        ),
        configurationResource('aws_db_instance.outcomes', 'aws_db_instance', {
          db_subnet_group_name: { references: ['aws_db_subnet_group.outcomes.name'] },
          kms_key_id: { references: ['aws_kms_key.database.arn'] },
          master_user_secret_kms_key_id: { references: ['aws_kms_key.database.arn'] },
          vpc_security_group_ids: { references: ['aws_security_group.database.id'] },
        }),
        configurationResource(
          'aws_elasticache_replication_group.admission',
          'aws_elasticache_replication_group',
          {
            security_group_ids: { references: ['aws_security_group.cache.id'] },
            subnet_group_name: { references: ['aws_elasticache_subnet_group.admission.name'] },
          }
        ),
        configurationResource(
          'aws_s3_bucket_server_side_encryption_configuration.logging',
          'aws_s3_bucket_server_side_encryption_configuration',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource(
          'aws_s3_bucket_ownership_controls.logging',
          'aws_s3_bucket_ownership_controls',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource(
          'aws_s3_bucket_public_access_block.logging',
          'aws_s3_bucket_public_access_block',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource('aws_s3_bucket_versioning.logging', 'aws_s3_bucket_versioning', {
          bucket: deterministicBucketExpression,
        }),
        configurationResource(
          'aws_s3_bucket_lifecycle_configuration.logging',
          'aws_s3_bucket_lifecycle_configuration',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource('aws_s3_bucket_policy.logging', 'aws_s3_bucket_policy', {
          bucket: deterministicBucketExpression,
        }),
        configurationResource(
          'aws_s3_bucket_ownership_controls.custody',
          'aws_s3_bucket_ownership_controls',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource('aws_s3_bucket_logging.custody', 'aws_s3_bucket_logging', {
          bucket: deterministicBucketExpression,
          target_bucket: deterministicBucketExpression,
        }),
        configurationResource(
          'aws_s3_bucket_public_access_block.custody',
          'aws_s3_bucket_public_access_block',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource('aws_s3_bucket_versioning.custody', 'aws_s3_bucket_versioning', {
          bucket: deterministicBucketExpression,
        }),
        configurationResource(
          'aws_s3_bucket_lifecycle_configuration.custody',
          'aws_s3_bucket_lifecycle_configuration',
          { bucket: deterministicBucketExpression }
        ),
        configurationResource(
          'aws_s3_bucket_server_side_encryption_configuration.custody',
          'aws_s3_bucket_server_side_encryption_configuration',
          {
            bucket: deterministicBucketExpression,
            rule: [
              {
                apply_server_side_encryption_by_default: [
                  {
                    kms_master_key_id: { references: ['aws_kms_key.custody.arn'] },
                    sse_algorithm: { constant_value: 'aws:kms' },
                  },
                ],
              },
            ],
          }
        ),
        configurationResource('aws_iam_policy.capture', 'aws_iam_policy', {
          policy: { references: ['data.aws_iam_policy_document.capture.json'] },
        }),
        configurationResource('data.aws_iam_policy_document.capture', 'aws_iam_policy_document', {
          statement: [
            statement(['s3:GetObject', 's3:PutObject'], ['aws_s3_bucket.custody.arn']),
            statement(
              ['elasticache:Connect'],
              [
                'aws_elasticache_replication_group.admission.arn',
                'aws_elasticache_user.capture.arn',
              ]
            ),
          ],
        }),
        configurationResource('aws_iam_role_policy.capture_kms', 'aws_iam_role_policy', {
          policy: { references: ['data.aws_iam_policy_document.capture_kms.json'] },
        }),
        configurationResource(
          'data.aws_iam_policy_document.capture_kms',
          'aws_iam_policy_document',
          {
            statement: [
              statement(
                ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
                ['aws_kms_key.custody.arn']
              ),
            ],
          }
        ),
        configurationResource('aws_iam_role_policy.task_execution', 'aws_iam_role_policy', {
          policy: { references: ['data.aws_iam_policy_document.task_execution.json'] },
        }),
        configurationResource(
          'data.aws_iam_policy_document.task_execution',
          'aws_iam_policy_document',
          {
            statement: [
              statement(
                ['secretsmanager:GetSecretValue'],
                ['aws_secretsmanager_secret.runtime_database_url.arn']
              ),
            ],
          }
        ),
        configurationResource('aws_iam_role_policy.migration', 'aws_iam_role_policy', {
          policy: { references: ['data.aws_iam_policy_document.migration.json'] },
        }),
        configurationResource('data.aws_iam_policy_document.migration', 'aws_iam_policy_document', {
          statement: [
            statement(
              ['secretsmanager:GetSecretValue'],
              ['aws_db_instance.outcomes.master_user_secret[0].secret_arn']
            ),
          ],
        }),
        configurationResource(
          'aws_iam_role_policy_attachments_exclusive.capture',
          'aws_iam_role_policy_attachments_exclusive',
          {
            policy_arns: { references: ['aws_iam_policy.capture.arn'] },
            role_name: { references: ['aws_iam_role.capture.name'] },
          }
        ),
        configurationResource(
          'aws_iam_role_policies_exclusive.capture',
          'aws_iam_role_policies_exclusive',
          { role_name: { references: ['aws_iam_role.capture.name'] } }
        ),
        securityGroupRule(
          'aws_vpc_security_group_egress_rule.worker_dns_udp',
          'aws_security_group.worker.id'
        ),
        securityGroupRule(
          'aws_vpc_security_group_egress_rule.worker_dns_tcp',
          'aws_security_group.worker.id'
        ),
        securityGroupRule(
          'aws_vpc_security_group_egress_rule.worker_database',
          'aws_security_group.worker.id',
          'aws_security_group.database.id'
        ),
        securityGroupRule(
          'aws_vpc_security_group_egress_rule.worker_cache',
          'aws_security_group.worker.id',
          'aws_security_group.cache.id'
        ),
        configurationResource('data.aws_prefix_list.s3', 'aws_prefix_list', {
          name: { constant_value: 'com.amazonaws.ap-southeast-2.s3' },
        }),
        configurationResource(
          'aws_vpc_security_group_egress_rule.worker_s3',
          'aws_vpc_security_group_egress_rule',
          {
            prefix_list_id: { references: ['data.aws_prefix_list.s3.id'] },
            security_group_id: { references: ['aws_security_group.worker.id'] },
          }
        ),
        securityGroupRule(
          'aws_vpc_security_group_ingress_rule.database_worker',
          'aws_security_group.database.id',
          'aws_security_group.worker.id'
        ),
        securityGroupRule(
          'aws_vpc_security_group_ingress_rule.cache_worker',
          'aws_security_group.cache.id',
          'aws_security_group.worker.id'
        ),
      ],
    },
  };
}

function safePlan(): Readonly<Record<string, unknown>> {
  return {
    format_version: '1.2',
    variables: {
      aws_account_id: { value: '111122223333' },
      aws_region: { value: 'ap-southeast-2' },
      capture_retention_days: { value: 365 },
      database_backup_retention_days: { value: 7 },
      enable_migration_secret_access: { value: true },
      permissions_boundary_arn: { value: null },
      vpc_cidr: { value: '10.64.0.0/16' },
    },
    configuration: planConfiguration(),
    resource_changes: [
      ...foundationPresenceResources(),
      resource('aws_db_instance.outcomes', 'aws_db_instance', {
        backup_retention_period: 7,
        db_subnet_group_name: roleName('database'),
        deletion_protection: true,
        engine: 'postgres',
        engine_version: '16.9',
        final_snapshot_identifier: 'statly-afl-trade-non-production-postgres-final',
        kms_key_id: databaseKeyArn,
        manage_master_user_password: true,
        master_user_secret_kms_key_id: databaseKeyArn,
        master_user_secret: [{ secret_arn: migrationSecretArn }],
        publicly_accessible: false,
        skip_final_snapshot: false,
        storage_encrypted: true,
        tags_all: { Environment: 'non_production' },
        username: 'afl_trade_migration',
        vpc_security_group_ids: ['sg-database'],
      }),
      resource('aws_kms_key.database', 'aws_kms_key', {
        arn: databaseKeyArn,
      }),
      resource('aws_elasticache_replication_group.admission', 'aws_elasticache_replication_group', {
        arn: cacheReplicationArn,
        at_rest_encryption_enabled: true,
        automatic_failover_enabled: true,
        replication_group_id: 'statly-afl-trade-non-production-admission',
        security_group_ids: ['sg-cache'],
        subnet_group_name: roleName('cache'),
        transit_encryption_enabled: true,
      }),
      resource('aws_elasticache_user.capture', 'aws_elasticache_user', {
        arn: cacheUserArn,
        user_id: 'statly-afl-trade-non-production-capture',
      }),
      resource('aws_s3_bucket.custody', 'aws_s3_bucket', {
        arn: custodyBucketArn,
        bucket: custodyBucketName,
        id: custodyBucketName,
      }),
      resource('aws_kms_key.custody', 'aws_kms_key', { arn: custodyKeyArn }),
      resource('aws_s3_bucket_public_access_block.custody', 'aws_s3_bucket_public_access_block', {
        block_public_acls: true,
        block_public_policy: true,
        bucket: custodyBucketName,
        ignore_public_acls: true,
        restrict_public_buckets: true,
      }),
      resource(
        'aws_s3_bucket_server_side_encryption_configuration.custody',
        'aws_s3_bucket_server_side_encryption_configuration',
        {
          bucket: custodyBucketName,
          rule: [
            {
              apply_server_side_encryption_by_default: [
                {
                  kms_master_key_id: 'arn:aws:kms:ap-southeast-2:111122223333:key/custody',
                  sse_algorithm: 'aws:kms',
                },
              ],
              bucket_key_enabled: true,
            },
          ],
        }
      ),
      resource('aws_s3_bucket_versioning.custody', 'aws_s3_bucket_versioning', {
        bucket: custodyBucketName,
        versioning_configuration: [{ status: 'Enabled' }],
      }),
      resource(
        'aws_s3_bucket_lifecycle_configuration.custody',
        'aws_s3_bucket_lifecycle_configuration',
        {
          bucket: custodyBucketName,
          rule: [
            {
              expiration: [{ days: 364 }],
              filter: [{ prefix: 'captures/' }],
              id: 'expire-captures-at-approved-maximum-age',
              noncurrent_version_expiration: [{ noncurrent_days: 1 }],
              status: 'Enabled',
            },
            {
              abort_incomplete_multipart_upload: [{ days_after_initiation: 7 }],
              filter: [],
              id: 'abort-incomplete-multipart-uploads',
              status: 'Enabled',
            },
          ],
        }
      ),
      resource('aws_s3_bucket_policy.custody_safety', 'aws_s3_bucket_policy', {
        bucket: custodyBucketName,
        policy: custodySafetyPolicy(),
      }),
      resource('aws_iam_policy.capture', 'aws_iam_policy', {
        arn: 'arn:aws:iam::111122223333:policy/statly-afl-trade-non-production-capture',
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:PutObject'],
              Resource: `${custodyBucketArn}/captures/*`,
            },
            {
              Effect: 'Allow',
              Action: 'elasticache:Connect',
              Resource: [cacheReplicationArn, cacheUserArn],
            },
          ],
        }),
      }),
      resource('aws_iam_role_policy.capture_kms', 'aws_iam_role_policy', {
        policy: kmsPolicy(
          ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
          custodyKeyAlias
        ),
        role: roleName('capture'),
      }),
      resource('aws_secretsmanager_secret.runtime_database_url', 'aws_secretsmanager_secret', {
        arn: runtimeSecretArn,
        name: '/statly/afl-trade/non_production/outcomes-runtime-database-url',
      }),
      resource('aws_iam_role_policy.task_execution', 'aws_iam_role_policy', {
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PullExactDispatcherRepository',
              Effect: 'Allow',
              Action: [
                'ecr:BatchCheckLayerAvailability',
                'ecr:BatchGetImage',
                'ecr:GetDownloadUrlForLayer',
              ],
              Resource:
                'arn:aws:ecr:ap-southeast-2:111122223333:repository/statly-afl-trade-non-production-external-dispatcher',
            },
            {
              Sid: 'ObtainEcrAuthorizationToken',
              Effect: 'Allow',
              Action: 'ecr:GetAuthorizationToken',
              Resource: '*',
            },
            {
              Sid: 'WriteDispatcherLogs',
              Effect: 'Allow',
              Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              Resource:
                'arn:aws:logs:ap-southeast-2:111122223333:log-group:/statly/afl-trade/non_production/external-dispatcher:*',
            },
            {
              Sid: 'ReadExactRuntimeSecret',
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: runtimeSecretPattern,
            },
            {
              Sid: 'DecryptExactRuntimeSecret',
              Effect: 'Allow',
              Action: ['kms:Decrypt', 'kms:DescribeKey'],
              Resource: databaseKeyPattern,
              Condition: {
                'ForAnyValue:StringEquals': { 'kms:ResourceAliases': databaseKeyAlias },
              },
            },
          ],
        }),
        role: roleName('task-execution'),
      }),
      resource('aws_iam_role_policy.migration[0]', 'aws_iam_role_policy', {
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'ReadExactMigrationSecret',
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: migrationSecretArn,
            },
            {
              Sid: 'DecryptExactDatabaseSecret',
              Effect: 'Allow',
              Action: ['kms:Decrypt', 'kms:DescribeKey'],
              Resource: databaseKeyPattern,
              Condition: {
                'ForAnyValue:StringEquals': { 'kms:ResourceAliases': databaseKeyAlias },
              },
            },
          ],
        }),
        role: roleName('migration'),
      }),
      resource('aws_iam_role_policy.retention_admin', 'aws_iam_role_policy', {
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'ReadAndDeleteExactCustodyVersions',
              Effect: 'Allow',
              Action: [
                's3:DeleteObject',
                's3:DeleteObjectVersion',
                's3:GetObject',
                's3:GetObjectVersion',
              ],
              Resource: `${custodyBucketArn}/*`,
            },
            {
              Sid: 'UseCustodyKeyForReviewedWithdrawal',
              Effect: 'Allow',
              Action: ['kms:Decrypt', 'kms:DescribeKey'],
              Resource: custodyKeyPattern,
              Condition: {
                'ForAnyValue:StringEquals': { 'kms:ResourceAliases': custodyKeyAlias },
              },
            },
          ],
        }),
        role: roleName('retention-admin'),
      }),
      resource('aws_iam_role_policy.scheduler', 'aws_iam_role_policy', {
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'RunExactDispatcherTask',
              Effect: 'Allow',
              Action: 'ecs:RunTask',
              Resource:
                'arn:aws:ecs:ap-southeast-2:111122223333:task-definition/statly-afl-trade-non-production-external-dispatcher:*',
              Condition: {
                ArnEquals: {
                  'ecs:cluster':
                    'arn:aws:ecs:ap-southeast-2:111122223333:cluster/statly-afl-trade-non-production',
                },
              },
            },
            {
              Sid: 'PassExactDispatcherRoles',
              Effect: 'Allow',
              Action: 'iam:PassRole',
              Resource: [
                captureRoleArn,
                `arn:aws:iam::111122223333:role/${roleName('task-execution')}`,
              ],
              Condition: {
                StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
              },
            },
          ],
        }),
        role: roleName('scheduler'),
      }),
      resource('aws_iam_role.capture', 'aws_iam_role', {
        arn: captureRoleArn,
        assume_role_policy: ecsTrustPolicy,
        inline_policy: [],
        managed_policy_arns: [
          'arn:aws:iam::111122223333:policy/statly-afl-trade-non-production-capture',
        ],
        name: roleName('capture'),
        permissions_boundary: null,
      }),
      resource('aws_iam_role.migration', 'aws_iam_role', {
        arn: `arn:aws:iam::111122223333:role/${roleName('migration')}`,
        assume_role_policy: ecsTrustPolicy,
        inline_policy: [],
        managed_policy_arns: [],
        name: roleName('migration'),
        permissions_boundary: null,
      }),
      resource('aws_iam_role.retention_admin', 'aws_iam_role', {
        arn: retentionRoleArn,
        assume_role_policy: ecsTrustPolicy,
        inline_policy: [],
        managed_policy_arns: [],
        name: roleName('retention-admin'),
        permissions_boundary: null,
      }),
      resource('aws_iam_role.scheduler', 'aws_iam_role', {
        arn: `arn:aws:iam::111122223333:role/${roleName('scheduler')}`,
        assume_role_policy: schedulerTrustPolicy,
        inline_policy: [],
        managed_policy_arns: [],
        name: roleName('scheduler'),
        permissions_boundary: null,
      }),
      resource('aws_iam_role.task_execution', 'aws_iam_role', {
        arn: `arn:aws:iam::111122223333:role/${roleName('task-execution')}`,
        assume_role_policy: ecsTrustPolicy,
        inline_policy: [],
        managed_policy_arns: [],
        name: roleName('task-execution'),
        permissions_boundary: null,
      }),
      resource(
        'aws_iam_role_policy_attachments_exclusive.capture',
        'aws_iam_role_policy_attachments_exclusive',
        {
          policy_arns: ['arn:aws:iam::111122223333:policy/statly-afl-trade-non-production-capture'],
          role_name: roleName('capture'),
        }
      ),
      resource(
        'aws_iam_role_policy_attachments_exclusive.migration',
        'aws_iam_role_policy_attachments_exclusive',
        { policy_arns: [], role_name: roleName('migration') }
      ),
      resource(
        'aws_iam_role_policy_attachments_exclusive.retention_admin',
        'aws_iam_role_policy_attachments_exclusive',
        { policy_arns: [], role_name: roleName('retention-admin') }
      ),
      resource(
        'aws_iam_role_policy_attachments_exclusive.scheduler',
        'aws_iam_role_policy_attachments_exclusive',
        { policy_arns: [], role_name: roleName('scheduler') }
      ),
      resource(
        'aws_iam_role_policy_attachments_exclusive.task_execution',
        'aws_iam_role_policy_attachments_exclusive',
        { policy_arns: [], role_name: roleName('task-execution') }
      ),
      resource('aws_iam_role_policies_exclusive.capture', 'aws_iam_role_policies_exclusive', {
        policy_names: [roleName('capture-kms')],
        role_name: roleName('capture'),
      }),
      resource('aws_iam_role_policies_exclusive.migration', 'aws_iam_role_policies_exclusive', {
        policy_names: [roleName('migration')],
        role_name: roleName('migration'),
      }),
      resource(
        'aws_iam_role_policies_exclusive.retention_admin',
        'aws_iam_role_policies_exclusive',
        {
          policy_names: [roleName('retention-admin')],
          role_name: roleName('retention-admin'),
        }
      ),
      resource('aws_iam_role_policies_exclusive.scheduler', 'aws_iam_role_policies_exclusive', {
        policy_names: [roleName('scheduler')],
        role_name: roleName('scheduler'),
      }),
      resource(
        'aws_iam_role_policies_exclusive.task_execution',
        'aws_iam_role_policies_exclusive',
        {
          policy_names: [roleName('task-execution')],
          role_name: roleName('task-execution'),
        }
      ),
      resource('aws_security_group.worker', 'aws_security_group', {
        egress: [],
        id: 'sg-worker',
        ingress: [],
        vpc_id: 'vpc-outcomes',
      }),
      resource('aws_security_group.database', 'aws_security_group', {
        egress: [],
        id: 'sg-database',
        ingress: [],
        vpc_id: 'vpc-outcomes',
      }),
      resource('aws_security_group.cache', 'aws_security_group', {
        egress: [],
        id: 'sg-cache',
        ingress: [],
        vpc_id: 'vpc-outcomes',
      }),
      resource(
        'aws_vpc_security_group_egress_rule.worker_dns_udp',
        'aws_vpc_security_group_egress_rule',
        {
          cidr_ipv4: '10.64.0.2/32',
          from_port: 53,
          ip_protocol: 'udp',
          security_group_id: 'sg-worker',
          to_port: 53,
        }
      ),
      resource(
        'aws_vpc_security_group_egress_rule.worker_dns_tcp',
        'aws_vpc_security_group_egress_rule',
        {
          cidr_ipv4: '10.64.0.2/32',
          from_port: 53,
          ip_protocol: 'tcp',
          security_group_id: 'sg-worker',
          to_port: 53,
        }
      ),
      resource(
        'aws_vpc_security_group_egress_rule.worker_database',
        'aws_vpc_security_group_egress_rule',
        {
          from_port: 5432,
          ip_protocol: 'tcp',
          referenced_security_group_id: 'sg-database',
          security_group_id: 'sg-worker',
          to_port: 5432,
        }
      ),
      resource(
        'aws_vpc_security_group_egress_rule.worker_cache',
        'aws_vpc_security_group_egress_rule',
        {
          from_port: 6379,
          ip_protocol: 'tcp',
          referenced_security_group_id: 'sg-cache',
          security_group_id: 'sg-worker',
          to_port: 6379,
        }
      ),
    ],
  };
}

function withResourceChanges(
  plan: Readonly<Record<string, unknown>>,
  transform: (change: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | null
): Readonly<Record<string, unknown>> {
  return {
    ...plan,
    resource_changes: (plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>)
      .map(transform)
      .filter((change): change is Readonly<Record<string, unknown>> => change !== null),
  };
}

function computePlan(): Readonly<Record<string, unknown>> {
  const plan = safePlan();
  return {
    ...plan,
    resource_changes: [
      ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
      resource('aws_ecs_task_definition.external_dispatcher', 'aws_ecs_task_definition', {
        family: 'statly-afl-trade-non-production-external-dispatcher',
      }),
      resource('aws_scheduler_schedule.external_capture', 'aws_scheduler_schedule', {
        state: 'DISABLED',
      }),
      resource('aws_cloudwatch_metric_alarm.dispatcher_failed', 'aws_cloudwatch_metric_alarm', {
        alarm_name: 'statly-afl-trade-non-production-dispatcher-failed',
      }),
    ],
  };
}

function freshPreapplyPlan(): Readonly<Record<string, unknown>> {
  const plan = withResourceChanges(safePlan(), (change) => {
    const address = change.address;
    const current = change.change as { after: Readonly<Record<string, unknown>> };
    if (address === 'aws_db_instance.outcomes') {
      return resource(
        address,
        'aws_db_instance',
        {
          ...current.after,
          kms_key_id: null,
          master_user_secret_kms_key_id: null,
          master_user_secret: null,
          vpc_security_group_ids: [null],
        },
        {
          kms_key_id: true,
          master_user_secret_kms_key_id: true,
          master_user_secret: true,
          vpc_security_group_ids: [true],
        }
      );
    }
    if (address === 'aws_vpc.outcomes') {
      return resource(address, change.type as string, { ...current.after, id: null }, { id: true });
    }
    if (typeof address === 'string' && address.startsWith('aws_subnet.')) {
      return resource(
        address,
        change.type as string,
        { ...current.after, id: null, vpc_id: null },
        { id: true, vpc_id: true }
      );
    }
    if (address === 'aws_route_table.worker' || address === 'aws_route_table.data') {
      return resource(
        address,
        change.type as string,
        { ...current.after, id: null, vpc_id: null },
        { id: true, vpc_id: true }
      );
    }
    if (typeof address === 'string' && address.startsWith('aws_route_table_association.')) {
      return resource(
        address,
        change.type as string,
        { ...current.after, route_table_id: null, subnet_id: null },
        { route_table_id: true, subnet_id: true }
      );
    }
    if (address === 'aws_vpc_endpoint.s3') {
      return resource(
        address,
        change.type as string,
        { ...current.after, route_table_ids: [null], vpc_id: null },
        { route_table_ids: [true], vpc_id: true }
      );
    }
    if (
      address === 'aws_db_subnet_group.outcomes' ||
      address === 'aws_elasticache_subnet_group.admission'
    ) {
      return resource(
        address,
        change.type as string,
        { ...current.after, subnet_ids: [null, null] },
        { subnet_ids: [true, true] }
      );
    }
    if (address === 'aws_elasticache_replication_group.admission') {
      return resource(
        address,
        change.type as string,
        { ...current.after, arn: null, security_group_ids: [null] },
        { arn: true, security_group_ids: [true] }
      );
    }
    if (address === 'aws_s3_bucket.custody' || address === 'aws_s3_bucket.logging') {
      return resource(
        address,
        change.type as string,
        { ...current.after, arn: null, id: null },
        { arn: true, id: true }
      );
    }
    if (
      address === 'aws_elasticache_user.capture' ||
      address === 'aws_kms_key.database' ||
      address === 'aws_iam_policy.capture' ||
      address === 'aws_secretsmanager_secret.runtime_database_url'
    ) {
      return resource(
        address as string,
        change.type as string,
        { ...current.after, arn: null },
        {
          arn: true,
        }
      );
    }
    if (address === 'aws_kms_key.custody') {
      return resource(
        address,
        change.type as string,
        { ...current.after, arn: null },
        { arn: true }
      );
    }
    if (address === 'aws_s3_bucket_policy.custody_safety') {
      return resource(
        address,
        change.type as string,
        { ...current.after, policy: null },
        { policy: true }
      );
    }
    if (address === 'aws_iam_role.capture') {
      return resource(
        address,
        change.type as string,
        { ...current.after, managed_policy_arns: [null] },
        { managed_policy_arns: true }
      );
    }
    if (
      address === 'aws_security_group.worker' ||
      address === 'aws_security_group.database' ||
      address === 'aws_security_group.cache'
    ) {
      return resource(
        address,
        change.type as string,
        { ...current.after, id: null, vpc_id: null },
        { id: true, vpc_id: true }
      );
    }
    if (
      typeof address === 'string' &&
      (address.startsWith('aws_vpc_security_group_egress_rule.') ||
        address.startsWith('aws_vpc_security_group_ingress_rule.'))
    ) {
      return resource(
        address,
        change.type as string,
        {
          ...current.after,
          security_group_id: null,
          ...(current.after.referenced_security_group_id === undefined
            ? {}
            : { referenced_security_group_id: null }),
        },
        {
          security_group_id: true,
          ...(current.after.referenced_security_group_id === undefined
            ? {}
            : { referenced_security_group_id: true }),
        }
      );
    }
    if (address === 'aws_s3_bucket_server_side_encryption_configuration.custody') {
      return resource(
        address,
        'aws_s3_bucket_server_side_encryption_configuration',
        {
          bucket: current.after.bucket,
          rule: [
            {
              apply_server_side_encryption_by_default: [
                { kms_master_key_id: null, sse_algorithm: 'aws:kms' },
              ],
            },
          ],
        },
        {
          rule: [
            {
              apply_server_side_encryption_by_default: [{ kms_master_key_id: true }],
            },
          ],
        }
      );
    }
    if (canonicalPlanAddress(address) === 'aws_iam_role_policy.migration') return null;
    if (address === 'aws_iam_role_policies_exclusive.migration') {
      return resource(address, change.type as string, {
        ...current.after,
        policy_names: [],
      });
    }
    return change;
  });
  return {
    ...plan,
    variables: {
      ...(plan.variables as Readonly<Record<string, unknown>>),
      enable_migration_secret_access: { value: false },
    },
  };
}

describe('AFL trade non-production infrastructure plan policy', () => {
  it('pins validation to the exact reviewed OpenTofu source digest', async () => {
    await expect(
      computeAflTradeNonproductionConfigurationSourceDigest(
        join(process.cwd(), 'infrastructure/afl-trade-nonproduction')
      )
    ).resolves.toBe(configurationSourceDigest);
  });

  it('accepts the isolated foundation without pretending future compute already exists', () => {
    expect(validateAflTradeNonproductionPlan(safePlan())).toEqual([]);
  });

  it('accepts fresh pre-apply unknowns only when configuration references exact resources', () => {
    expect(validateAflTradeNonproductionPlan(freshPreapplyPlan())).toEqual([]);
  });

  it('rejects deletions, replacements and malformed plan changes before policy evaluation', () => {
    const plan = safePlan();
    const changes = plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>;
    const deletePlan = {
      ...plan,
      resource_changes: changes.map((change) =>
        change.address === 'aws_s3_bucket_policy.logging'
          ? {
              ...change,
              change: { actions: ['delete'], after: null, after_unknown: {} },
            }
          : change
      ),
    };
    const replacePlan = {
      ...plan,
      resource_changes: changes.map((change) =>
        change.address === 'aws_db_instance.outcomes'
          ? {
              ...change,
              change: {
                ...(change.change as Readonly<Record<string, unknown>>),
                actions: ['delete', 'create'],
              },
            }
          : change
      ),
    };

    expect(validateAflTradeNonproductionPlan(deletePlan)).toEqual([
      expect.objectContaining({ code: 'PLAN_SHAPE_INVALID' }),
    ]);
    expect(validateAflTradeNonproductionPlan(replacePlan)).toEqual([
      expect.objectContaining({ code: 'PLAN_SHAPE_INVALID' }),
    ]);
  });

  it('requires the complete exact singleton and for-each foundation graph', () => {
    const missing = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_s3_bucket_logging.custody' ? null : change
    );
    const plan = safePlan();
    const multiplied = {
      ...plan,
      resource_changes: [
        ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
        resource('aws_db_instance.outcomes["shadow"]', 'aws_db_instance', {
          backup_retention_period: 7,
          deletion_protection: true,
          engine: 'postgres',
          engine_version: '16.9',
          manage_master_user_password: true,
          publicly_accessible: false,
          storage_encrypted: true,
        }),
      ],
    };

    expect(validateAflTradeNonproductionPlan(missing).map((issue) => issue.code)).toContain(
      'FOUNDATION_GRAPH_INVALID'
    );
    expect(validateAflTradeNonproductionPlan(multiplied).map((issue) => issue.code)).toContain(
      'FOUNDATION_GRAPH_INVALID'
    );
  });

  it('binds the rendered plan to the exact reviewed Terraform source digest', () => {
    const unreviewedDigest = 'b'.repeat(64);
    const unsafe = withResourceChanges(safePlan(), (change) =>
      change.address === 'terraform_data.configuration_attestation'
        ? resource(change.address, change.type as string, { input: unreviewedDigest })
        : change
    );

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['CONFIGURATION_ATTESTATION_INVALID', 'NETWORK_BOUNDARY_INVALID'])
    );
    expect(
      validateRawAflTradeNonproductionPlan(unsafe, {
        configurationSourceDigest: unreviewedDigest,
      }).map((issue) => issue.code)
    ).toContain('CONFIGURATION_ATTESTATION_INVALID');
  });

  it('rejects consistently renamed custody identities outside the reviewed account-region names', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      const after = JSON.parse(
        JSON.stringify(current.after)
          .replaceAll(custodyBucketName, 'shared-custody')
          .replaceAll(loggingBucketName, 'shared-logs')
      ) as Readonly<Record<string, unknown>>;
      return resource(change.address as string, change.type as string, after);
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['CUSTODY_SAFETY_POLICY_INVALID', 'LOGGING_SAFETY_POLICY_INVALID'])
    );
  });

  it('rejects a mutually consistent shared VPC, subnet, route and security-group graph', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      const after = JSON.parse(
        JSON.stringify(current.after)
          .replaceAll('vpc-outcomes', 'vpc-shared')
          .replaceAll('10.64.0.0/16', '10.0.0.0/8')
          .replaceAll('subnet-worker-a', 'subnet-shared-worker-a')
          .replaceAll('subnet-worker-b', 'subnet-shared-worker-b')
          .replaceAll('subnet-data-a', 'subnet-shared-data-a')
          .replaceAll('subnet-data-b', 'subnet-shared-data-b')
          .replaceAll('rt-worker', 'rt-shared-worker')
          .replaceAll('rt-data', 'rt-shared-data')
      ) as Readonly<Record<string, unknown>>;
      return resource(change.address as string, change.type as string, after);
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'NETWORK_BOUNDARY_INVALID'
    );
  });

  it('rejects non-default inline routes on the isolated route tables', () => {
    const unsafe = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_route_table.worker'
        ? resource(change.address, change.type as string, {
            ...(change.change as { after: Readonly<Record<string, unknown>> }).after,
            route: [
              {
                cidr_block: '10.0.0.0/8',
                transit_gateway_id: 'tgw-shared',
              },
            ],
          })
        : change
    );

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'NETWORK_BOUNDARY_INVALID'
    );
  });

  it('admits migration access only after the exact RDS-managed secret ARN is plan-known', () => {
    expect(validateAflTradeNonproductionPlan(freshPreapplyPlan())).toEqual([]);

    const wrongSecret = withResourceChanges(safePlan(), (change) => {
      if (typeof change.address !== 'string') return change;
      if (canonicalPlanAddress(change.address) !== 'aws_iam_role_policy.migration') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      return resource(change.address, change.type as string, {
        ...current.after,
        policy: (current.after.policy as string).replace(
          migrationSecretArn,
          'arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:operator-copy'
        ),
      });
    });

    expect(validateAflTradeNonproductionPlan(wrongSecret).map((issue) => issue.code)).toContain(
      'DATABASE_SECRET_POLICY_INVALID'
    );
  });

  it('validates the complete logging delivery policy rather than its address', () => {
    const unsafe = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_s3_bucket_policy.logging'
        ? resource(change.address, change.type as string, {
            policy: loggingSafetyPolicy().replace(custodyBucketArn, 'arn:aws:s3:::unrelated'),
          })
        : change
    );

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'LOGGING_SAFETY_POLICY_INVALID'
    );

    const publicLogging = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_s3_bucket_public_access_block.logging'
        ? resource(change.address, change.type as string, {
            block_public_acls: false,
            block_public_policy: false,
            ignore_public_acls: false,
            restrict_public_buckets: false,
          })
        : change
    );
    expect(validateAflTradeNonproductionPlan(publicLogging).map((issue) => issue.code)).toContain(
      'LOGGING_SAFETY_POLICY_INVALID'
    );
  });

  it('binds database and cache ingress to the worker and forbids embedded SG or role grants', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      if (change.address === 'aws_vpc_security_group_ingress_rule.database_worker') {
        return resource(change.address, change.type as string, {
          ...current.after,
          cidr_ipv4: '0.0.0.0/0',
          referenced_security_group_id: null,
        });
      }
      if (change.address === 'aws_security_group.cache') {
        return resource(change.address, change.type as string, {
          ...current.after,
          ingress: [{ cidr_blocks: ['0.0.0.0/0'], from_port: 6379, to_port: 6379 }],
        });
      }
      if (change.address === 'aws_db_instance.outcomes') {
        return resource(change.address, change.type as string, {
          ...current.after,
          db_subnet_group_name: 'shared-database-subnets',
          vpc_security_group_ids: ['sg-unreviewed'],
        });
      }
      if (change.address === 'aws_elasticache_replication_group.admission') {
        return resource(change.address, change.type as string, {
          ...current.after,
          security_group_ids: ['sg-unreviewed'],
          subnet_group_name: 'shared-cache-subnets',
        });
      }
      if (change.address === 'aws_iam_role.capture') {
        return resource(change.address, change.type as string, {
          ...current.after,
          managed_policy_arns: ['arn:aws:iam::aws:policy/AdministratorAccess'],
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['NETWORK_BOUNDARY_INVALID', 'IAM_GRAPH_INVALID'])
    );
  });

  it('binds every custody and logging control to the reviewed buckets', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      if (change.address === 'aws_s3_bucket_ownership_controls.custody') {
        return resource(change.address, change.type as string, {
          ...current.after,
          bucket: 'unreviewed-custody',
          rule: [{ object_ownership: 'ObjectWriter' }],
        });
      }
      if (change.address === 'aws_s3_bucket_logging.custody') {
        return resource(change.address, change.type as string, {
          ...current.after,
          target_bucket: 'unreviewed-logging',
          target_prefix: '',
        });
      }
      if (change.address === 'aws_s3_bucket_versioning.custody') {
        return resource(change.address, change.type as string, {
          ...current.after,
          bucket: 'unreviewed-custody',
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['CUSTODY_SAFETY_POLICY_INVALID'])
    );
  });

  it('requires the RDS-managed migration credential and its reviewed database boundary', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address !== 'aws_db_instance.outcomes') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      return resource(change.address, change.type as string, {
        ...current.after,
        manage_master_user_password: false,
        master_user_secret_kms_key_id: custodyKeyArn,
        username: 'postgres',
      });
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'DATABASE_SECRET_POLICY_INVALID'
    );
  });

  it('validates complete custody safety semantics rather than trusted-looking Sids', () => {
    const unsafe = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_s3_bucket_policy.custody_safety'
        ? resource(change.address, change.type as string, {
            policy: custodySafetyPolicy().replace('s3:if-none-match', 's3:unrelated-header'),
          })
        : change
    );

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'CUSTODY_SAFETY_POLICY_INVALID'
    );
  });

  it('requires bounded access-log retention and the exact custody KMS key ARN', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      if (change.address === 'aws_s3_bucket_lifecycle_configuration.logging') {
        return resource(change.address, change.type as string, {
          ...current.after,
          rule: [
            {
              expiration: [{ days: 3650 }],
              filter: [{ prefix: 'access/' }],
              id: 'expire-access-logs-at-approved-maximum-age',
              noncurrent_version_expiration: [{ noncurrent_days: 30 }],
              status: 'Enabled',
            },
          ],
        });
      }
      if (change.address === 'aws_s3_bucket_policy.custody_safety') {
        return resource(change.address, change.type as string, {
          ...current.after,
          policy: custodySafetyPolicy().replace(custodyKeyArn, `${custodyKeyArn}-unreviewed`),
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['LOGGING_SAFETY_POLICY_INVALID', 'CUSTODY_SAFETY_POLICY_INVALID'])
    );
  });

  it('requires every IAM policy and attachment to remain on its reviewed role', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address === 'aws_iam_role_policy.capture_kms') {
        const current = change.change as { after: Readonly<Record<string, unknown>> };
        return resource(change.address, change.type as string, {
          ...current.after,
          role: roleName('task-execution'),
        });
      }
      if (change.address === 'aws_iam_role_policy_attachments_exclusive.capture') {
        const current = change.change as { after: Readonly<Record<string, unknown>> };
        return resource(change.address, change.type as string, {
          ...current.after,
          role_name: roleName('migration'),
        });
      }
      if (change.address === 'aws_iam_role_policies_exclusive.task_execution') {
        const current = change.change as { after: Readonly<Record<string, unknown>> };
        return resource(change.address, change.type as string, {
          ...current.after,
          policy_names: [roleName('task-execution'), 'unreviewed-admin'],
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'IAM_GRAPH_INVALID'
    );
  });

  it('rejects unknown or additional managed-policy attachments on a fresh plan', () => {
    const unsafe = withResourceChanges(freshPreapplyPlan(), (change) => {
      if (change.address === 'aws_iam_role_policy_attachments_exclusive.migration') {
        const current = change.change as { after: Readonly<Record<string, unknown>> };
        return resource(
          change.address,
          change.type as string,
          { ...current.after, policy_arns: [null] },
          { policy_arns: [true] }
        );
      }
      if (change.address === 'aws_iam_role_policy_attachments_exclusive.capture') {
        const current = change.change as { after: Readonly<Record<string, unknown>> };
        return resource(
          change.address,
          change.type as string,
          {
            ...current.after,
            policy_arns: [null, 'arn:aws:iam::aws:policy/AdministratorAccess'],
          },
          { policy_arns: [true, false] }
        );
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'IAM_GRAPH_INVALID'
    );
  });

  it('rejects every overlapping destructive lifecycle rule', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address !== 'aws_s3_bucket_lifecycle_configuration.custody') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      return resource(change.address, change.type as string, {
        rule: [
          ...(current.after.rule as readonly unknown[]),
          {
            expiration: [{ days: 1 }],
            filter: [],
            id: 'delete-everything-early',
            status: 'Enabled',
          },
        ],
      });
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'CUSTODY_RETENTION_INVALID'
    );
  });

  it('rejects unreviewed resources and worker egress independently of their names', () => {
    const plan = safePlan();
    const issues = validateAflTradeNonproductionPlan({
      ...plan,
      resource_changes: [
        ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
        resource(
          'aws_vpc_security_group_egress_rule.escape',
          'aws_vpc_security_group_egress_rule',
          {
            cidr_ipv4: '0.0.0.0/0',
            security_group_id: 'sg-worker',
          }
        ),
        resource('aws_instance.escape', 'aws_instance', {}),
        resource('aws_sfn_state_machine.escape', 'aws_sfn_state_machine', {}),
      ],
    }).map((issue) => issue.code);

    expect(issues).toEqual(
      expect.arrayContaining(['WORKER_INTERNET_EGRESS_OPEN', 'UNAPPROVED_COMPUTE'])
    );
  });

  it('requires worker HTTPS egress to the exact regional S3 prefix list', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address !== 'aws_vpc_security_group_egress_rule.worker_s3') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      return resource(change.address, change.type as string, {
        ...current.after,
        prefix_list_id: 'pl-unreviewed',
      });
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'WORKER_INTERNET_EGRESS_OPEN'
    );
  });

  it('reports every authority and recoverability violation before apply', () => {
    const unsafePlan = computePlan();
    const resourceChanges = (
      unsafePlan.resource_changes as ReadonlyArray<Record<string, unknown>>
    ).map((change) => {
      const address = change.address;
      if (typeof address !== 'string') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };

      if (address === 'aws_db_instance.outcomes') {
        return resource(address, 'aws_db_instance', {
          ...current.after,
          backup_retention_period: 0,
          deletion_protection: false,
          kms_key_id: null,
          publicly_accessible: true,
          storage_encrypted: false,
        });
      }
      if (address === 'aws_elasticache_replication_group.admission') {
        return resource(address, 'aws_elasticache_replication_group', {
          ...current.after,
          at_rest_encryption_enabled: false,
          transit_encryption_enabled: false,
        });
      }
      if (address === 'aws_s3_bucket_public_access_block.custody') {
        return resource(address, 'aws_s3_bucket_public_access_block', {
          block_public_acls: false,
          block_public_policy: false,
          ignore_public_acls: false,
          restrict_public_buckets: false,
        });
      }
      if (address === 'aws_s3_bucket_versioning.custody') {
        return resource(address, 'aws_s3_bucket_versioning', {
          versioning_configuration: [{ status: 'Suspended' }],
        });
      }
      if (address === 'aws_s3_bucket_lifecycle_configuration.custody') {
        return resource(address, 'aws_s3_bucket_lifecycle_configuration', {
          rule: [
            {
              abort_incomplete_multipart_upload: [{ days_after_initiation: 7 }],
              id: 'abort-only',
              status: 'Enabled',
            },
          ],
        });
      }
      if (address === 'aws_iam_policy.capture') {
        return resource(address, 'aws_iam_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
          }),
        });
      }
      if (address === 'aws_scheduler_schedule.external_capture') {
        return resource(address, 'aws_scheduler_schedule', { state: 'ENABLED' });
      }
      if (address === 'aws_cloudwatch_metric_alarm.dispatcher_failed') return null;
      return change;
    });

    const workerInternetEgress = resource(
      'aws_vpc_security_group_egress_rule.worker_https',
      'aws_vpc_security_group_egress_rule',
      { cidr_ipv4: '0.0.0.0/0', from_port: 443, to_port: 443 }
    );

    expect(
      validateAflTradeNonproductionPlan({
        ...unsafePlan,
        resource_changes: [...resourceChanges.filter(Boolean), workerInternetEgress],
      }).map((issue) => issue.code)
    ).toEqual(
      expect.arrayContaining([
        'DATABASE_PUBLIC',
        'DATABASE_UNENCRYPTED',
        'DATABASE_KMS_MISSING',
        'DATABASE_BACKUPS_DISABLED',
        'DATABASE_DELETION_UNPROTECTED',
        'CACHE_AT_REST_UNENCRYPTED',
        'CACHE_TRANSIT_UNENCRYPTED',
        'CUSTODY_PUBLIC_ACCESS_UNBLOCKED',
        'CUSTODY_VERSIONING_DISABLED',
        'CUSTODY_RETENTION_INVALID',
        'CAPTURE_IAM_WILDCARD_ACTION',
        'CAPTURE_IAM_WILDCARD_RESOURCE',
        'WORKER_INTERNET_EGRESS_OPEN',
      ])
    );
  });

  it('rejects non-canonical authority, shared credentials and narrow unauthorized permissions', () => {
    const unsafePlan = safePlan();
    const resourceChanges = (
      unsafePlan.resource_changes as ReadonlyArray<Record<string, unknown>>
    ).map((change) => {
      const address = change.address;
      if (typeof address !== 'string') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };

      if (address === 'aws_db_instance.outcomes') {
        return resource(address, 'aws_db_instance', {
          ...current.after,
          tags_all: { Environment: 'nonproduction' },
        });
      }
      if (address === 'aws_iam_policy.capture') {
        return resource(address, 'aws_iam_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject', 's3:DeleteObject'],
                Resource: 'arn:aws:s3:::statly-afl-trade-non-production-custody',
              },
            ],
          }),
        });
      }
      if (address === 'aws_iam_role_policy.capture_kms') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['kms:Decrypt', 'kms:ScheduleKeyDeletion'],
                Resource: 'arn:aws:kms:ap-southeast-2:111122223333:key/custody',
              },
            ],
          }),
        });
      }
      if (canonicalPlanAddress(address) === 'aws_iam_role_policy.migration') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'ReadExactMigrationSecret',
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource:
                  'arn:aws:secretsmanager:ap-southeast-2:111122223333:secret:runtime-database-url',
              },
            ],
          }),
        });
      }
      return change;
    });

    expect(
      validateAflTradeNonproductionPlan({
        ...unsafePlan,
        resource_changes: resourceChanges,
      }).map((issue) => issue.code)
    ).toEqual(
      expect.arrayContaining([
        'AUTHORITY_ENVIRONMENT_INVALID',
        'CAPTURE_IAM_ACTION_NOT_ALLOWED',
        'CAPTURE_IAM_RESOURCE_NOT_ALLOWED',
        'CAPTURE_KMS_POLICY_INVALID',
        'DATABASE_SECRET_POLICY_INVALID',
      ])
    );
  });

  it('binds every capture permission and secret read to this exact planned stack', () => {
    const unsafePlan = withResourceChanges(safePlan(), (change) => {
      const address = change.address;
      if (address === 'aws_iam_policy.capture') {
        return resource(address, 'aws_iam_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: 'arn:aws:s3:::another-custody-bucket/captures/*',
              },
              {
                Effect: 'Allow',
                Action: 'elasticache:Connect',
                Resource: [
                  'arn:aws:elasticache:ap-southeast-2:111122223333:replicationgroup:another-cache',
                  'arn:aws:elasticache:ap-southeast-2:111122223333:user:another-user',
                ],
              },
            ],
          }),
        });
      }
      if (address === 'aws_iam_role_policy.capture_kms') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
                Resource: 'arn:aws:kms:ap-southeast-2:111122223333:key/another-key',
              },
            ],
          }),
        });
      }
      if (address === 'aws_iam_role_policy.task_execution') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'ReadExactRuntimeSecret',
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource: runtimeSecretArn,
              },
              {
                Sid: 'AlsoReadMigrationSecret',
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource: migrationSecretArn,
              },
            ],
          }),
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafePlan).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'CAPTURE_IAM_RESOURCE_NOT_ALLOWED',
        'CAPTURE_KMS_POLICY_INVALID',
        'DATABASE_SECRET_POLICY_INVALID',
      ])
    );
  });

  it('requires complete Allow statements rather than subsets or Deny lookalikes', () => {
    const unsafePlan = withResourceChanges(safePlan(), (change) => {
      const address = change.address;
      if (typeof address !== 'string') return change;
      if (address === 'aws_iam_policy.capture') {
        return resource(address, 'aws_iam_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 's3:GetObject',
                Resource: `${custodyBucketArn}/captures/*`,
              },
              {
                Effect: 'Allow',
                Action: 'elasticache:Connect',
                Resource: [cacheReplicationArn, cacheUserArn],
              },
            ],
          }),
        });
      }
      if (address === 'aws_iam_role_policy.capture_kms') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['kms:Decrypt', 'kms:DescribeKey'],
                Resource: custodyKeyArn,
              },
            ],
          }),
        });
      }
      if (canonicalPlanAddress(address) === 'aws_iam_role_policy.migration') {
        return resource(address, 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'ReadExactMigrationSecret',
                Effect: 'Deny',
                Action: 'secretsmanager:GetSecretValue',
                Resource: migrationSecretArn,
              },
            ],
          }),
        });
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafePlan).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'CAPTURE_IAM_POLICY_INVALID',
        'CAPTURE_KMS_POLICY_INVALID',
        'DATABASE_SECRET_POLICY_INVALID',
      ])
    );
  });

  it('fails closed when fresh-plan relationships point at different resources', () => {
    const plan = withResourceChanges(freshPreapplyPlan(), (change) =>
      change.address === 'aws_iam_policy.capture'
        ? resource(change.address, 'aws_iam_policy', { policy: null }, { policy: true })
        : change
    );
    const configuration = plan.configuration as {
      root_module: { resources: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    const resources = configuration.root_module.resources.map((current) => {
      if (current.address !== 'data.aws_iam_policy_document.capture') return current;
      return configurationResource(
        'data.aws_iam_policy_document.capture',
        'aws_iam_policy_document',
        {
          statement: [
            {
              actions: { constant_value: ['s3:GetObject', 's3:PutObject'] },
              effect: { constant_value: 'Allow' },
              resources: { references: ['aws_s3_bucket.unrelated.arn'] },
            },
          ],
        }
      );
    });

    expect(
      validateAflTradeNonproductionPlan({
        ...plan,
        configuration: { root_module: { resources } },
      }).map((issue) => issue.code)
    ).toContain('CAPTURE_IAM_POLICY_INVALID');
  });

  it('rejects additional capture actions even while fresh policy JSON is unknown', () => {
    const plan = withResourceChanges(freshPreapplyPlan(), (change) =>
      change.address === 'aws_iam_policy.capture'
        ? resource(change.address, 'aws_iam_policy', { policy: null }, { policy: true })
        : change
    );
    const configuration = plan.configuration as {
      root_module: { resources: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    const resources = configuration.root_module.resources.map((current) => {
      if (current.address !== 'data.aws_iam_policy_document.capture') return current;
      const expressions = current.expressions as { statement: readonly unknown[] };
      return {
        ...current,
        expressions: {
          statement: [
            ...expressions.statement,
            {
              actions: { constant_value: ['s3:DeleteObject'] },
              effect: { constant_value: 'Allow' },
              resources: { references: ['aws_s3_bucket.custody.arn'] },
            },
          ],
        },
      };
    });

    expect(
      validateAflTradeNonproductionPlan({
        ...plan,
        configuration: { root_module: { resources } },
      }).map((issue) => issue.code)
    ).toContain('CAPTURE_IAM_POLICY_INVALID');
  });

  it('rejects unknown capture policy JSON because references cannot prove the captures suffix', () => {
    const plan = withResourceChanges(freshPreapplyPlan(), (change) =>
      change.address === 'aws_iam_policy.capture'
        ? resource(change.address, 'aws_iam_policy', { policy: null }, { policy: true })
        : change
    );

    expect(validateAflTradeNonproductionPlan(plan).map((issue) => issue.code)).toContain(
      'CAPTURE_IAM_POLICY_INVALID'
    );
  });

  it('rejects wildcard and batch secret reads in fully rendered policies', () => {
    const knownUnsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address !== 'aws_iam_role_policy.task_execution') return change;
      return resource(change.address, 'aws_iam_role_policy', {
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue',
              Resource: runtimeSecretArn,
            },
            {
              Effect: 'Allow',
              Action: [
                'secretsmanager:Get*',
                'secretsmanager:BatchGetSecretValue',
                'secretsmanager:DescribeSecret',
                'secretsmanager:ListSecrets',
                'iam:PassRole',
              ],
              Resource: '*',
            },
          ],
        }),
      });
    });
    expect(validateAflTradeNonproductionPlan(knownUnsafe).map((issue) => issue.code)).toContain(
      'DATABASE_SECRET_POLICY_INVALID'
    );
  });

  it('rejects alternate foundation internet paths and split full-range worker egress', () => {
    const plan = safePlan();
    expect(
      validateAflTradeNonproductionPlan({
        ...plan,
        resource_changes: [
          ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
          resource('aws_internet_gateway.egress', 'aws_internet_gateway', {}),
          resource('aws_nat_gateway.worker', 'aws_nat_gateway', {}),
          resource('aws_route.worker_internet', 'aws_route', {
            destination_cidr_block: '0.0.0.0/0',
            gateway_id: 'pending',
          }),
          resource('aws_route.worker_ipv6_internet', 'aws_route', {
            destination_ipv6_cidr_block: '::/0',
            gateway_id: 'pending',
          }),
          resource('aws_security_group_rule.worker_https', 'aws_security_group_rule', {
            cidr_blocks: ['0.0.0.0/0'],
            type: 'egress',
          }),
          resource('aws_security_group.worker', 'aws_security_group', {
            egress: [
              {
                cidr_blocks: ['0.0.0.0/1', '128.0.0.0/1'],
                from_port: 443,
                protocol: 'tcp',
                to_port: 443,
              },
            ],
          }),
        ],
      }).map((issue) => issue.code)
    ).toContain('WORKER_INTERNET_EGRESS_OPEN');
  });

  it('binds KMS, backup and retention controls to this exact reviewed plan', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      if (change.address === 'aws_db_instance.outcomes') {
        return resource(change.address, change.type as string, {
          ...current.after,
          backup_retention_period: 1,
          kms_key_id: 'arn:aws:kms:ap-southeast-2:111122223333:key/unrelated',
        });
      }
      if (change.address === 'aws_s3_bucket_server_side_encryption_configuration.custody') {
        return resource(change.address, change.type as string, {
          rule: [
            {
              apply_server_side_encryption_by_default: [
                {
                  kms_master_key_id: 'arn:aws:kms:ap-southeast-2:111122223333:key/unrelated',
                  sse_algorithm: 'aws:kms',
                },
              ],
            },
          ],
        });
      }
      if (change.address === 'aws_s3_bucket_lifecycle_configuration.custody') {
        return resource(change.address, change.type as string, {
          rule: [
            ...(current.after.rule as readonly unknown[]),
            {
              expiration: [{ days: 1 }],
              filter: [{ prefix: 'captures/' }],
              id: 'overlapping-early-expiry',
              status: 'Enabled',
            },
          ],
        });
      }
      return change;
    });
    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'DATABASE_KMS_MISSING',
        'DATABASE_BACKUPS_DISABLED',
        'CUSTODY_ENCRYPTION_MISSING',
        'CUSTODY_RETENTION_INVALID',
      ])
    );

    const fresh = freshPreapplyPlan();
    const configuration = fresh.configuration as {
      root_module: { resources: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    const resources = configuration.root_module.resources.map((current) => {
      if (current.address !== 'aws_db_instance.outcomes') return current;
      return {
        ...current,
        expressions: {
          kms_key_id: {
            references: ['aws_kms_key.database.arn', 'aws_kms_key.unrelated.arn'],
          },
        },
      };
    });
    expect(
      validateAflTradeNonproductionPlan({
        ...fresh,
        configuration: { root_module: { resources } },
      }).map((issue) => issue.code)
    ).toContain('DATABASE_KMS_MISSING');
  });

  it('requires the reviewed final RDS snapshot identity', () => {
    const unsafe = withResourceChanges(safePlan(), (change) => {
      if (change.address !== 'aws_db_instance.outcomes') return change;
      const current = change.change as { after: Readonly<Record<string, unknown>> };
      return resource(change.address, change.type as string, {
        ...current.after,
        final_snapshot_identifier: null,
      });
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toContain(
      'DATABASE_BACKUPS_DISABLED'
    );
  });

  it('rejects alternate compute and schedules regardless of address shape', () => {
    const plan = safePlan();
    const issues = validateAflTradeNonproductionPlan({
      ...plan,
      resource_changes: [
        ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
        resource('aws_lambda_function.capture[0]', 'aws_lambda_function', {}),
        resource('aws_scheduler_schedule.shadow[0]', 'aws_scheduler_schedule', {
          state: 'ENABLED',
        }),
      ],
    }).map((issue) => issue.code);
    expect(issues).toEqual(
      expect.arrayContaining(['UNAPPROVED_COMPUTE', 'CAPTURE_SCHEDULE_ENABLED'])
    );
  });

  it('rejects extra IAM attachments and widened trust principals', () => {
    const plan = withResourceChanges(safePlan(), (change) =>
      change.address === 'aws_iam_role.capture'
        ? resource(change.address, change.type as string, {
            ...((change.change as { after: Readonly<Record<string, unknown>> }).after ?? {}),
            assume_role_policy: JSON.stringify({
              Statement: [
                {
                  Action: 'sts:AssumeRole',
                  Effect: 'Allow',
                  Principal: { AWS: '*', Service: 'ecs-tasks.amazonaws.com' },
                },
              ],
            }),
            permissions_boundary: 'arn:aws:iam::111122223333:policy/unreviewed-boundary',
          })
        : change
    );
    const issues = validateAflTradeNonproductionPlan({
      ...plan,
      resource_changes: [
        ...(plan.resource_changes as ReadonlyArray<Readonly<Record<string, unknown>>>),
        resource('aws_iam_role_policy.shadow_admin', 'aws_iam_role_policy', {
          policy: JSON.stringify({
            Statement: [{ Action: 'iam:*', Effect: 'Allow', Resource: '*' }],
          }),
        }),
      ],
    }).map((issue) => issue.code);
    expect(issues).toEqual(expect.arrayContaining(['IAM_GRAPH_INVALID', 'ROLE_TRUST_INVALID']));
  });

  it('rejects the entire later compute boundary until a separately reviewed validator admits it', () => {
    expect(validateAflTradeNonproductionPlan(computePlan()).map((issue) => issue.code)).toContain(
      'UNAPPROVED_COMPUTE'
    );
  });

  it('fails closed when the plan shape or required resources are absent', () => {
    expect(validateAflTradeNonproductionPlan({})).toEqual([
      expect.objectContaining({ code: 'PLAN_SHAPE_INVALID' }),
    ]);

    expect(
      validateAflTradeNonproductionPlan({ resource_changes: [] }).map((issue) => issue.code)
    ).toEqual(
      expect.arrayContaining([
        'DATABASE_MISSING',
        'CACHE_MISSING',
        'CUSTODY_BUCKET_MISSING',
        'CUSTODY_PUBLIC_ACCESS_BLOCK_MISSING',
        'CUSTODY_ENCRYPTION_MISSING',
        'CUSTODY_VERSIONING_MISSING',
        'CUSTODY_RETENTION_MISSING',
        'CUSTODY_SAFETY_POLICY_MISSING',
        'CAPTURE_IAM_POLICY_MISSING',
        'CAPTURE_KMS_POLICY_MISSING',
        'RUNTIME_DATABASE_SECRET_MISSING',
        'TASK_EXECUTION_POLICY_MISSING',
        'DATABASE_SECRET_POLICY_INVALID',
      ])
    );
  });

  it('creates, validates and removes one exact OpenTofu plan from the reviewed source', async () => {
    let savedPlanPath: string | undefined;
    let savedStatePath: string | undefined;
    let snapshotSourceDirectory: string | undefined;
    const execute = vi.fn(
      async (
        _command: string,
        args: readonly string[],
        options?: { readonly environment: Readonly<Record<string, string | undefined>> }
      ) => {
        if (args[1] === 'init') {
          snapshotSourceDirectory = args[0]?.slice('-chdir='.length);
          if (snapshotSourceDirectory === undefined) {
            throw new Error('test snapshot source directory was not supplied');
          }
          if (process.platform !== 'win32') {
            expect((await stat(snapshotSourceDirectory)).mode & 0o777).toBe(0o500);
            expect((await stat(join(snapshotSourceDirectory, 'review.tfrc'))).mode & 0o777).toBe(
              0o400
            );
          }
          const dataDirectory = options?.environment.TF_DATA_DIR;
          if (dataDirectory === undefined) throw new Error('test data directory was not supplied');
          await mkdir(join(dataDirectory, 'providers'), { recursive: true });
          await writeFile(join(dataDirectory, 'providers', 'generated-provider'), 'generated');
          return '';
        }
        if (args[1] === 'workspace') return 'default\n';
        if (args[1] === 'plan') {
          savedPlanPath = args.find((argument) => argument.startsWith('-out='))?.slice(5);
          savedStatePath = args.find((argument) => argument.startsWith('-state='))?.slice(7);
          if (savedPlanPath === undefined) throw new Error('test plan path was not supplied');
          if (savedStatePath === undefined) throw new Error('test state path was not supplied');
          const stateLockPath = `${savedStatePath}.lock.info`;
          await writeFile(stateLockPath, 'synthetic lock');
          await unlink(stateLockPath);
          await writeFile(savedPlanPath, 'synthetic reviewed plan');
          return '';
        }
        return JSON.stringify(freshPreapplyPlan());
      }
    );
    const writeOutput = vi.fn();

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        environment: {
          NODE_ENV: 'test',
          AWS_CONFIG_FILE: '/tmp/review-aws-config',
          AWS_ENDPOINT_URL: 'https://attacker.invalid',
          AWS_ENDPOINT_URL_STS: 'https://attacker.invalid/sts',
          AWS_PROFILE: 'review-profile',
          AWS_SHARED_CREDENTIALS_FILE: '/tmp/review-aws-credentials',
          HOME: '/tmp/unreviewed-home',
          PATH: '/usr/bin',
          TF_CLI_CONFIG_FILE: '/tmp/unreviewed.tfrc',
          TF_CLI_ARGS_plan: '-refresh=false',
          TF_WORKSPACE: 'shadow',
          TOFU_CLI_ARGS: '-lock=false',
          UNRELATED_RUNTIME_VALUE: ['not', 'forwarded'].join('-'),
        },
        execute,
        writeOutput,
      })
    ).resolves.toEqual({
      configurationSourceDigest,
      inputStateDigest: null,
      issueCount: 0,
      status: 'plan_policy_passed',
    });
    expect(snapshotSourceDirectory).toMatch(/statly-afl-trade-nonproduction-plan-.+\/source$/);
    const snapshotRoot = dirname(snapshotSourceDirectory!);
    const executionEnvironment = {
      AWS_CONFIG_FILE: '/tmp/review-aws-config',
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
      AWS_PROFILE: 'review-profile',
      AWS_SHARED_CREDENTIALS_FILE: '/tmp/review-aws-credentials',
      PATH: '/usr/bin',
      TF_CLI_CONFIG_FILE: join(snapshotSourceDirectory!, 'review.tfrc'),
      TF_DATA_DIR: join(snapshotRoot, 'data'),
    };
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'tofu',
      [
        `-chdir=${snapshotSourceDirectory}`,
        'init',
        '-backend=true',
        '-input=false',
        '-lockfile=readonly',
      ],
      {
        environment: executionEnvironment,
        signal: expect.any(AbortSignal),
        timeoutMs: 300_000,
      }
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'tofu',
      [`-chdir=${snapshotSourceDirectory}`, 'workspace', 'show'],
      {
        environment: executionEnvironment,
        signal: expect.any(AbortSignal),
        timeoutMs: 30_000,
      }
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      'tofu',
      [
        `-chdir=${snapshotSourceDirectory}`,
        'plan',
        '-input=false',
        '-refresh=true',
        '-lock=true',
        '-lock-timeout=30s',
        '-parallelism=10',
        expect.stringMatching(/^-out=.+\/review\.tfplan$/),
        expect.stringMatching(/^-state=.+\/state\/terraform\.tfstate$/),
        '-var=aws_account_id=111122223333',
        '-var=aws_region=ap-southeast-2',
        '-var=environment=non_production',
        '-var=vpc_cidr=10.64.0.0/16',
        '-var=database_instance_class=db.t4g.micro',
        '-var=database_backup_retention_days=7',
        '-var=enable_migration_secret_access=false',
        '-var=capture_retention_days=365',
        '-var=cache_node_type=cache.t4g.micro',
        '-var=permissions_boundary_arn=null',
        '-var=tags={}',
      ],
      {
        environment: executionEnvironment,
        signal: expect.any(AbortSignal),
        timeoutMs: 600_000,
      }
    );
    expect(execute).toHaveBeenNthCalledWith(
      4,
      'tofu',
      [`-chdir=${snapshotSourceDirectory}`, 'show', '-json', savedPlanPath],
      {
        environment: executionEnvironment,
        signal: expect.any(AbortSignal),
        timeoutMs: 60_000,
      }
    );
    expect(writeOutput).toHaveBeenCalledWith(
      JSON.stringify({
        configurationSourceDigest,
        inputStateDigest: null,
        issueCount: 0,
        status: 'plan_policy_passed',
      })
    );
    expect(savedPlanPath).toBeDefined();
    expect(savedStatePath).toBe(join(snapshotRoot, 'state', 'terraform.tfstate'));
    await expect(access(snapshotRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed without exposing rendered plan contents', async () => {
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'workspace') return 'default\n';
      return args[1] === 'show' ? JSON.stringify({ resource_changes: [] }) : '';
    });
    const writeOutput = vi.fn();

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        execute,
        writeOutput,
      })
    ).rejects.toThrow(/DATABASE_MISSING/);
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('rejects arbitrary saved plans and source changes during snapshot creation', async () => {
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: ['--plan', '/tmp/foreign.tfplan'],
      })
    ).rejects.toThrow(/Unsupported plan validation option/);

    const deferredInputExecute = vi.fn(async () => {
      throw new Error('OpenTofu execution must not start for a deferred foundation input.');
    });
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: [...boundedPlanArgv, '--operator-email', 'operator@example.com'],
        execute: deferredInputExecute,
      })
    ).rejects.toThrow(/Unsupported plan validation option/);
    expect(deferredInputExecute).not.toHaveBeenCalled();

    const computeConfigurationSourceDigest = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(configurationSourceDigest)
      .mockResolvedValueOnce('b'.repeat(64))
      .mockResolvedValueOnce(configurationSourceDigest);
    const execute = vi.fn(async () => '');
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest,
        execute,
      })
    ).rejects.toThrow(/source changed while the owned plan snapshot was being created/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects malformed account and retention inputs before OpenTofu execution', async () => {
    const invalidArguments = [
      ['--aws-account-id', '11112222333', '--capture-retention-days', '365'],
      ['--aws-account-id', '11112222333x', '--capture-retention-days', '365'],
      ['--aws-account-id', '111122223333', '--capture-retention-days', '1'],
      ['--aws-account-id', '111122223333', '--capture-retention-days', '3651'],
      ['--aws-account-id', '111122223333', '--capture-retention-days', '2.5'],
      [
        '--aws-account-id',
        '111122223333',
        '--capture-retention-days',
        '365',
        '--database-backup-retention-days',
        '6',
      ],
      [
        '--aws-account-id',
        '111122223333',
        '--capture-retention-days',
        '365',
        '--database-backup-retention-days',
        '35.5',
      ],
    ] as const;

    for (const argv of invalidArguments) {
      const execute = vi.fn(async () => '');
      await expect(
        runAflTradeNonproductionPlanValidationCommand({ argv, execute })
      ).rejects.toThrow(/must be/);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('rejects foreign workspaces and late source drift before reporting success', async () => {
    const foreignWorkspace = vi.fn(async () => 'shadow\n');
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        execute: foreignWorkspace,
      })
    ).rejects.toThrow(/default OpenTofu workspace/);
    expect(foreignWorkspace).toHaveBeenCalledTimes(2);

    const computeConfigurationSourceDigest = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(configurationSourceDigest)
      .mockResolvedValueOnce(configurationSourceDigest)
      .mockResolvedValueOnce(configurationSourceDigest)
      .mockResolvedValueOnce('b'.repeat(64));
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'workspace') return 'default\n';
      return args[1] === 'show' ? JSON.stringify(freshPreapplyPlan()) : '';
    });
    const writeOutput = vi.fn();
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest,
        execute,
        writeOutput,
      })
    ).rejects.toThrow(/owned Terraform snapshot changed while the plan was being created/);
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('plans from the immutable snapshot when the mutable workspace changes after copying', async () => {
    let mutableWorkspaceDigest = configurationSourceDigest;
    const computeConfigurationSourceDigest = vi.fn(async (sourceDirectory?: string) =>
      sourceDirectory?.endsWith('/source') ? configurationSourceDigest : mutableWorkspaceDigest
    );
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'init') {
        mutableWorkspaceDigest = 'b'.repeat(64);
        return '';
      }
      if (args[1] === 'workspace') return 'default\n';
      return args[1] === 'show' ? JSON.stringify(freshPreapplyPlan()) : '';
    });
    const writeOutput = vi.fn();

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest,
        execute,
        writeOutput,
      })
    ).resolves.toEqual({
      configurationSourceDigest,
      inputStateDigest: null,
      issueCount: 0,
      status: 'plan_policy_passed',
    });
    expect(writeOutput).toHaveBeenCalledWith(
      JSON.stringify({
        configurationSourceDigest,
        inputStateDigest: null,
        issueCount: 0,
        status: 'plan_policy_passed',
      })
    );
  });

  it('copies and identifies one explicit prior state for the later migration phase', async () => {
    const stateFixtureDirectory = await mkdtemp(join(tmpdir(), 'statly-afl-trade-state-test-'));
    const priorStatePath = join(stateFixtureDirectory, 'prior.tfstate');
    const priorStateBytes = JSON.stringify({ lineage: 'reviewed-lineage', serial: 1, version: 4 });
    const inputStateDigest = createHash('sha256').update(priorStateBytes).digest('hex');
    await writeFile(priorStatePath, priorStateBytes, { mode: 0o644 });
    let copiedStatePath: string | undefined;
    const writeOutput = vi.fn();
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'workspace') return 'default\n';
      if (args[1] === 'plan') {
        copiedStatePath = args.find((argument) => argument.startsWith('-state='))?.slice(7);
        if (copiedStatePath === undefined) throw new Error('test state path was not supplied');
        expect(await readFile(copiedStatePath, 'utf8')).toBe(priorStateBytes);
        expect(copiedStatePath).not.toBe(priorStatePath);
        if (process.platform !== 'win32') {
          expect((await stat(copiedStatePath)).mode & 0o777).toBe(0o600);
        }
        return '';
      }
      return args[1] === 'show' ? JSON.stringify(safePlan()) : '';
    });

    try {
      await expect(
        runAflTradeNonproductionPlanValidationCommand({
          argv: [...boundedPlanArgv, '--enable-migration-secret-access', '--state', priorStatePath],
          computeConfigurationSourceDigest: async () => configurationSourceDigest,
          execute,
          writeOutput,
        })
      ).resolves.toEqual({
        configurationSourceDigest,
        inputStateDigest,
        issueCount: 0,
        status: 'plan_policy_passed',
      });
      expect(copiedStatePath).toBeDefined();
      expect(writeOutput).toHaveBeenCalledWith(
        JSON.stringify({
          configurationSourceDigest,
          inputStateDigest,
          issueCount: 0,
          status: 'plan_policy_passed',
        })
      );
      await expect(access(dirname(dirname(copiedStatePath!)))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(stateFixtureDirectory, { force: true, recursive: true });
    }
  });

  it('fails closed when an admitted state pathname is swapped to a symlink', async () => {
    const stateFixtureDirectory = await mkdtemp(
      join(tmpdir(), 'statly-afl-trade-state-swap-test-')
    );
    const priorStatePath = join(stateFixtureDirectory, 'prior.tfstate');
    const movedPriorStatePath = join(stateFixtureDirectory, 'admitted.tfstate');
    const substitutedStatePath = join(stateFixtureDirectory, 'substituted.tfstate');
    const priorStateBytes = JSON.stringify({ lineage: 'reviewed-lineage', serial: 2, version: 4 });
    const substitutedStateBytes = JSON.stringify({
      lineage: 'unreviewed-lineage',
      serial: 999,
      version: 4,
    });
    await writeFile(priorStatePath, priorStateBytes, { mode: 0o644 });
    await writeFile(substitutedStatePath, substitutedStateBytes, { mode: 0o600 });
    const afterPriorStateOpen = vi.fn(async () => {
      await rename(priorStatePath, movedPriorStatePath);
      await symlink(substitutedStatePath, priorStatePath);
    });
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'workspace') return 'default\n';
      if (args[1] === 'plan') {
        const copiedStatePath = args.find((argument) => argument.startsWith('-state='))?.slice(7);
        if (copiedStatePath === undefined) throw new Error('test state path was not supplied');
        return '';
      }
      return args[1] === 'show' ? JSON.stringify(safePlan()) : '';
    });

    try {
      await expect(
        runAflTradeNonproductionPlanValidationCommand({
          afterPriorStateOpen,
          argv: [...boundedPlanArgv, '--enable-migration-secret-access', '--state', priorStatePath],
          computeConfigurationSourceDigest: async () => configurationSourceDigest,
          execute,
          writeOutput: vi.fn(),
        })
      ).rejects.toThrow(/state changed while its owned snapshot was being created/);
      expect(afterPriorStateOpen).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await rm(stateFixtureDirectory, { force: true, recursive: true });
    }
  });

  it('bounds and cancels prior-state streaming before OpenTofu execution', async () => {
    const stateFixtureDirectory = await mkdtemp(
      join(tmpdir(), 'statly-afl-trade-state-bound-test-')
    );
    const oversizedStatePath = join(stateFixtureDirectory, 'oversized.tfstate');
    const cancellableStatePath = join(stateFixtureDirectory, 'cancellable.tfstate');
    await writeFile(oversizedStatePath, '');
    await truncate(oversizedStatePath, 64 * 1024 * 1024 + 1);
    await writeFile(cancellableStatePath, 'reviewed state bytes');
    const execute = vi.fn(async () => '');

    try {
      await expect(
        runAflTradeNonproductionPlanValidationCommand({
          argv: [
            ...boundedPlanArgv,
            '--enable-migration-secret-access',
            '--state',
            oversizedStatePath,
          ],
          execute,
        })
      ).rejects.toThrow(/exceeds the reviewed 64 MiB limit/);
      expect(execute).not.toHaveBeenCalled();

      const controller = new AbortController();
      const afterPriorStateOpen = vi.fn(() => {
        controller.abort(new Error('operator cancelled prior-state streaming'));
      });
      await expect(
        runAflTradeNonproductionPlanValidationCommand({
          afterPriorStateOpen,
          argv: [
            ...boundedPlanArgv,
            '--enable-migration-secret-access',
            '--state',
            cancellableStatePath,
          ],
          execute,
          signal: controller.signal,
        })
      ).rejects.toThrow(/operator cancelled prior-state streaming/);
      expect(afterPriorStateOpen).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await rm(stateFixtureDirectory, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a prior-state FIFO without blocking before regular-file admission',
    async () => {
      const stateFixtureDirectory = await mkdtemp(
        join(tmpdir(), 'statly-afl-trade-state-fifo-test-')
      );
      const fifoPath = join(stateFixtureDirectory, 'prior.tfstate');
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = execFile('mkfifo', [fifoPath], (error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        });
        child.unref();
      });
      const execute = vi.fn(async () => '');
      const startedAt = performance.now();
      const unblockTimer = setTimeout(() => {
        void open(fifoPath, constants.O_WRONLY | constants.O_NONBLOCK)
          .then((handle) => handle.close())
          .catch(() => undefined);
      }, 500);

      try {
        await expect(
          runAflTradeNonproductionPlanValidationCommand({
            argv: [...boundedPlanArgv, '--enable-migration-secret-access', '--state', fifoPath],
            execute,
          })
        ).rejects.toThrow(/must be one regular file, not a link/);
        expect(performance.now() - startedAt).toBeLessThan(250);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        clearTimeout(unblockTimer);
        await rm(stateFixtureDirectory, { force: true, recursive: true });
      }
    }
  );

  it('requires regular prior state and removes partial snapshots after sequential copy failure', async () => {
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: [...boundedPlanArgv, '--enable-migration-secret-access'],
      })
    ).rejects.toThrow(/requires one explicit --state path/);

    let failedSnapshotRoot: string | undefined;
    const copySnapshotFile = vi.fn(
      async (...[source, destination]: Parameters<typeof copyFile>) => {
        failedSnapshotRoot = dirname(dirname(destination.toString()));
        if (source.toString().endsWith('/network.tf')) {
          throw new Error('synthetic sequential copy failure');
        }
        await copyFile(source, destination);
      }
    );
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        copySnapshotFile,
      })
    ).rejects.toThrow(/synthetic sequential copy failure/);
    expect(failedSnapshotRoot).toBeDefined();
    await expect(access(failedSnapshotRoot!)).rejects.toMatchObject({ code: 'ENOENT' });

    const controller = new AbortController();
    let cancelledSnapshotRoot: string | undefined;
    const cancelDuringCopy = vi.fn(
      async (...[source, destination]: Parameters<typeof copyFile>) => {
        cancelledSnapshotRoot = dirname(dirname(destination.toString()));
        await copyFile(source, destination);
        if (source.toString().endsWith('/network.tf')) {
          controller.abort(new Error('operator cancelled during snapshot copy'));
        }
      }
    );
    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        copySnapshotFile: cancelDuringCopy,
        signal: controller.signal,
      })
    ).rejects.toThrow(/operator cancelled during snapshot copy/);
    expect(cancelledSnapshotRoot).toBeDefined();
    await expect(access(cancelledSnapshotRoot!)).rejects.toMatchObject({ code: 'ENOENT' });

    const stateFixtureDirectory = await mkdtemp(
      join(tmpdir(), 'statly-afl-trade-state-link-test-')
    );
    const linkedStatePath = join(stateFixtureDirectory, 'linked.tfstate');
    try {
      await symlink('missing-state', linkedStatePath);
      await expect(
        runAflTradeNonproductionPlanValidationCommand({
          argv: [
            ...boundedPlanArgv,
            '--enable-migration-secret-access',
            '--state',
            linkedStatePath,
          ],
        })
      ).rejects.toThrow(/must be one regular file, not a link/);
    } finally {
      await rm(stateFixtureDirectory, { force: true, recursive: true });
    }
  });

  it('forwards cancellation and removes its exact temporary plan directory', async () => {
    const controller = new AbortController();
    let savedPlanPath: string | undefined;
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'init') return '';
      if (args[1] === 'workspace') return 'default\n';
      if (args[1] === 'plan') {
        savedPlanPath = args.find((argument) => argument.startsWith('-out='))?.slice(5);
        controller.abort(new Error('operator cancelled'));
        throw controller.signal.reason;
      }
      return '';
    });

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        execute,
        signal: controller.signal,
      })
    ).rejects.toThrow(/operator cancelled/);
    expect(savedPlanPath).toBeDefined();
    await expect(access(dirname(dirname(savedPlanPath!)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not report success when cancellation arrives during exact cleanup', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'init') return '';
      if (args[1] === 'workspace') return 'default\n';
      return args[1] === 'show' ? JSON.stringify(freshPreapplyPlan()) : '';
    });
    const writeOutput = vi.fn();
    const beforeSnapshotCleanup = vi.fn(() => {
      controller.abort(new Error('operator cancelled during cleanup'));
    });

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        beforeSnapshotCleanup,
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        execute,
        signal: controller.signal,
        writeOutput,
      })
    ).rejects.toThrow(/operator cancelled during cleanup/);
    expect(beforeSnapshotCleanup).toHaveBeenCalledTimes(1);
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('removes the owned snapshot even when the pre-cleanup hook fails', async () => {
    let snapshotRoot: string | undefined;
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === 'init') {
        const sourceDirectory = args[0]?.slice('-chdir='.length);
        if (sourceDirectory === undefined) throw new Error('test snapshot source was not supplied');
        snapshotRoot = dirname(sourceDirectory);
        return '';
      }
      if (args[1] === 'workspace') return 'default\n';
      return args[1] === 'show' ? JSON.stringify(freshPreapplyPlan()) : '';
    });

    await expect(
      runAflTradeNonproductionPlanValidationCommand({
        argv: boundedPlanArgv,
        beforeSnapshotCleanup: () => {
          throw new Error('synthetic pre-cleanup hook failure');
        },
        computeConfigurationSourceDigest: async () => configurationSourceDigest,
        execute,
        writeOutput: vi.fn(),
      })
    ).rejects.toThrow(/synthetic pre-cleanup hook failure/);
    expect(snapshotRoot).toBeDefined();
    await expect(access(snapshotRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects OpenTofu precedence files and symlinked configuration entries', async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'statly-afl-trade-source-test-'));
    try {
      await Promise.all(
        [
          '.terraform.lock.hcl',
          'attestation.tf',
          'custody.tf',
          'data.tf',
          'iam.tf',
          'network.tf',
          'providers.tf',
          'review.tfrc',
          'variables.tf',
          'versions.tf',
        ].map((filename) => writeFile(join(sourceDirectory, filename), filename))
      );
      await expect(
        computeAflTradeNonproductionConfigurationSourceDigest(sourceDirectory)
      ).resolves.toMatch(/^[a-f0-9]{64}$/);

      const precedencePath = join(sourceDirectory, 'network.tofu');
      await writeFile(precedencePath, 'unreviewed precedence source');
      await expect(
        computeAflTradeNonproductionConfigurationSourceDigest(sourceDirectory)
      ).rejects.toThrow(/manifest differs from the exact reviewed file set/);
      await unlink(precedencePath);

      await symlink('missing-source', join(sourceDirectory, 'extra.tofu.json'));
      await expect(
        computeAflTradeNonproductionConfigurationSourceDigest(sourceDirectory)
      ).rejects.toThrow(/must be regular files, not links/);
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
    }
  });

  it('rejects security policies whose exact rendered statements are unknown', () => {
    const unsafe = withResourceChanges(freshPreapplyPlan(), (change) => {
      if (
        change.address === 'aws_s3_bucket_policy.custody_safety' ||
        change.address === 'aws_iam_role_policy.capture_kms' ||
        change.address === 'aws_iam_role_policy.task_execution' ||
        canonicalPlanAddress(change.address) === 'aws_iam_role_policy.migration'
      ) {
        return resource(
          change.address as string,
          change.type as string,
          { policy: null },
          {
            policy: true,
          }
        );
      }
      return change;
    });

    expect(validateAflTradeNonproductionPlan(unsafe).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'CUSTODY_SAFETY_POLICY_INVALID',
        'CAPTURE_KMS_POLICY_INVALID',
        'DATABASE_SECRET_POLICY_INVALID',
      ])
    );
  });
});
