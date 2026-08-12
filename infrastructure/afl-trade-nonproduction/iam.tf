locals {
  dispatcher_repository_name = "${local.name_prefix}-external-dispatcher"
  dispatcher_task_family     = "${local.name_prefix}-external-dispatcher"
  capture_prefix_arn         = "arn:aws:s3:::${local.bucket_stem}-custody/captures/*"
  capture_policy_arn         = "arn:aws:iam::${var.aws_account_id}:policy/${local.name_prefix}-capture"
  cache_replication_arn      = "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:replicationgroup:${local.name_prefix}-admission"
  cache_user_arn             = "arn:aws:elasticache:${var.aws_region}:${var.aws_account_id}:user:${local.name_prefix}-capture"
  custody_key_alias          = "alias/${local.name_prefix}-custody"
  custody_key_alias_arn      = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:${local.custody_key_alias}"
  custody_key_pattern        = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
  database_key_alias         = "alias/${local.name_prefix}-database"
  database_key_pattern       = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
  runtime_secret_pattern     = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:/statly/afl-trade/${var.environment}/outcomes-runtime-database-url-*"
  capture_role_arn           = "arn:aws:iam::${var.aws_account_id}:role/${local.name_prefix}-capture"
  retention_admin_role_arn   = "arn:aws:iam::${var.aws_account_id}:role/${local.name_prefix}-retention-admin"
  task_execution_role_arn    = "arn:aws:iam::${var.aws_account_id}:role/${local.name_prefix}-task-execution"
}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      identifiers = ["ecs-tasks.amazonaws.com"]
      type        = "Service"
    }
  }
}

resource "aws_secretsmanager_secret" "runtime_database_url" {
  description             = "Operator-populated isolated outcomes runtime URL; Terraform creates no value"
  kms_key_id              = aws_kms_key.database.arn
  name                    = "/statly/afl-trade/${var.environment}/outcomes-runtime-database-url"
  recovery_window_in_days = 30

  tags = {
    Name      = "${local.name_prefix}-outcomes-database-url"
    Authority = "none"
  }
}

resource "aws_iam_role" "task_execution" {
  assume_role_policy    = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  description           = "Pulls the pinned dispatcher image, injects approved secrets and writes logs"
  name                  = "${local.name_prefix}-task-execution"
  permissions_boundary  = var.permissions_boundary_arn
  force_detach_policies = true
}

data "aws_iam_policy_document" "task_execution" {
  statement {
    sid = "PullExactDispatcherRepository"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    effect = "Allow"
    resources = [
      "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/${local.dispatcher_repository_name}",
    ]
  }

  statement {
    sid       = "ObtainEcrAuthorizationToken"
    actions   = ["ecr:GetAuthorizationToken"]
    effect    = "Allow"
    resources = ["*"]
  }

  statement {
    sid = "WriteDispatcherLogs"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    effect = "Allow"
    resources = [
      "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/statly/afl-trade/${var.environment}/external-dispatcher:*",
    ]
  }

  statement {
    sid       = "ReadExactRuntimeSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    effect    = "Allow"
    resources = [local.runtime_secret_pattern]
  }

  statement {
    sid = "DecryptExactRuntimeSecret"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    effect    = "Allow"
    resources = [local.database_key_pattern]

    condition {
      test     = "ForAnyValue:StringEquals"
      values   = [local.database_key_alias]
      variable = "kms:ResourceAliases"
    }
  }
}

resource "aws_iam_role_policy" "task_execution" {
  name   = "${local.name_prefix}-task-execution"
  policy = data.aws_iam_policy_document.task_execution.json
  role   = aws_iam_role.task_execution.name
}

resource "aws_iam_role" "capture" {
  assume_role_policy    = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  description           = "Stages governed source evidence without release or publication authority"
  name                  = "${local.name_prefix}-capture"
  permissions_boundary  = var.permissions_boundary_arn
  force_detach_policies = true

  tags = {
    Authority = "capture-only"
  }
}

data "aws_iam_policy_document" "capture" {
  statement {
    sid = "ConditionalCustodyReadWrite"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    effect    = "Allow"
    resources = [local.capture_prefix_arn]
  }

  statement {
    sid       = "ConnectAsCaptureAdmissionUser"
    actions   = ["elasticache:Connect"]
    effect    = "Allow"
    resources = [local.cache_replication_arn, local.cache_user_arn]
  }
}

resource "aws_iam_policy" "capture" {
  description = "Exact object prefix and IAM-authenticated Redis access for governed capture"
  name        = "${local.name_prefix}-capture"
  policy      = data.aws_iam_policy_document.capture.json
}

resource "aws_iam_role_policy_attachments_exclusive" "capture" {
  policy_arns = [local.capture_policy_arn]
  role_name   = aws_iam_role.capture.name
}

data "aws_iam_policy_document" "capture_kms" {
  statement {
    sid = "UseCustodyKey"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]
    effect    = "Allow"
    resources = [local.custody_key_pattern]

    condition {
      test     = "ForAnyValue:StringEquals"
      values   = [local.custody_key_alias]
      variable = "kms:ResourceAliases"
    }
  }
}

resource "aws_iam_role_policy" "capture_kms" {
  name   = "${local.name_prefix}-capture-kms"
  policy = data.aws_iam_policy_document.capture_kms.json
  role   = aws_iam_role.capture.name
}

resource "aws_iam_role" "migration" {
  assume_role_policy    = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  description           = "Runs reviewed forward-only outcomes migrations without source or release access"
  name                  = "${local.name_prefix}-migration"
  permissions_boundary  = var.permissions_boundary_arn
  force_detach_policies = true

  tags = {
    Authority = "schema-migration-only"
  }
}

data "aws_iam_policy_document" "migration" {
  count = var.enable_migration_secret_access ? 1 : 0

  statement {
    sid       = "ReadExactMigrationSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    effect    = "Allow"
    resources = [aws_db_instance.outcomes.master_user_secret[0].secret_arn]
  }

  statement {
    sid = "DecryptExactDatabaseSecret"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    effect    = "Allow"
    resources = [local.database_key_pattern]

    condition {
      test     = "ForAnyValue:StringEquals"
      values   = [local.database_key_alias]
      variable = "kms:ResourceAliases"
    }
  }
}

resource "aws_iam_role_policy" "migration" {
  count = var.enable_migration_secret_access ? 1 : 0

  name   = "${local.name_prefix}-migration"
  policy = data.aws_iam_policy_document.migration[0].json
  role   = aws_iam_role.migration.name
}

resource "aws_iam_role" "retention_admin" {
  assume_role_policy    = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  description           = "Separately invoked reviewed withdrawal and retention administration"
  name                  = "${local.name_prefix}-retention-admin"
  permissions_boundary  = var.permissions_boundary_arn
  force_detach_policies = true

  tags = {
    Authority = "reviewed-retention-only"
  }
}

data "aws_iam_policy_document" "retention_admin" {
  statement {
    sid = "ReadAndDeleteExactCustodyVersions"

    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    effect    = "Allow"
    resources = ["${local.custody_bucket_arn}/*"]
  }

  statement {
    sid = "UseCustodyKeyForReviewedWithdrawal"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    effect    = "Allow"
    resources = [local.custody_key_pattern]

    condition {
      test     = "ForAnyValue:StringEquals"
      values   = [local.custody_key_alias]
      variable = "kms:ResourceAliases"
    }
  }
}

resource "aws_iam_role_policy" "retention_admin" {
  name   = "${local.name_prefix}-retention-admin"
  policy = data.aws_iam_policy_document.retention_admin.json
  role   = aws_iam_role.retention_admin.name
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      identifiers = ["scheduler.amazonaws.com"]
      type        = "Service"
    }
  }
}

resource "aws_iam_role" "scheduler" {
  assume_role_policy    = data.aws_iam_policy_document.scheduler_assume_role.json
  description           = "Starts only the bounded external dispatcher task"
  name                  = "${local.name_prefix}-scheduler"
  permissions_boundary  = var.permissions_boundary_arn
  force_detach_policies = true
}

resource "aws_iam_role_policy_attachments_exclusive" "migration" {
  policy_arns = []
  role_name   = aws_iam_role.migration.name
}

resource "aws_iam_role_policy_attachments_exclusive" "retention_admin" {
  policy_arns = []
  role_name   = aws_iam_role.retention_admin.name
}

resource "aws_iam_role_policy_attachments_exclusive" "scheduler" {
  policy_arns = []
  role_name   = aws_iam_role.scheduler.name
}

resource "aws_iam_role_policy_attachments_exclusive" "task_execution" {
  policy_arns = []
  role_name   = aws_iam_role.task_execution.name
}

resource "aws_iam_role_policies_exclusive" "capture" {
  policy_names = ["${local.name_prefix}-capture-kms"]
  role_name    = aws_iam_role.capture.name
}

resource "aws_iam_role_policies_exclusive" "migration" {
  policy_names = var.enable_migration_secret_access ? ["${local.name_prefix}-migration"] : []
  role_name    = aws_iam_role.migration.name
}

resource "aws_iam_role_policies_exclusive" "retention_admin" {
  policy_names = ["${local.name_prefix}-retention-admin"]
  role_name    = aws_iam_role.retention_admin.name
}

resource "aws_iam_role_policies_exclusive" "scheduler" {
  policy_names = ["${local.name_prefix}-scheduler"]
  role_name    = aws_iam_role.scheduler.name
}

resource "aws_iam_role_policies_exclusive" "task_execution" {
  policy_names = ["${local.name_prefix}-task-execution"]
  role_name    = aws_iam_role.task_execution.name
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid = "RunExactDispatcherTask"

    actions = ["ecs:RunTask"]
    effect  = "Allow"
    resources = [
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/${local.dispatcher_task_family}:*",
    ]

    condition {
      test     = "ArnEquals"
      values   = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:cluster/${local.name_prefix}"]
      variable = "ecs:cluster"
    }
  }

  statement {
    sid = "PassExactDispatcherRoles"

    actions = ["iam:PassRole"]
    effect  = "Allow"
    resources = [
      local.capture_role_arn,
      local.task_execution_role_arn,
    ]

    condition {
      test     = "StringEquals"
      values   = ["ecs-tasks.amazonaws.com"]
      variable = "iam:PassedToService"
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${local.name_prefix}-scheduler"
  policy = data.aws_iam_policy_document.scheduler.json
  role   = aws_iam_role.scheduler.name
}
