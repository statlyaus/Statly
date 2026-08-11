locals {
  bucket_stem        = "statly-afl-trade-np-${var.aws_account_id}-${var.aws_region}"
  custody_bucket_arn = "arn:aws:s3:::${local.bucket_stem}-custody"
  logging_bucket_arn = "arn:aws:s3:::${local.bucket_stem}-logs"
}

resource "aws_kms_key" "custody" {
  description             = "AFL trade non-production immutable source custody"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-custody"
  }
}

resource "aws_kms_alias" "custody" {
  name          = "alias/${local.name_prefix}-custody"
  target_key_id = aws_kms_key.custody.key_id
}

resource "aws_s3_bucket" "logging" {
  bucket = "${local.bucket_stem}-logs"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "${local.name_prefix}-custody-access-logs"
    Authority = "none"
  }
}

resource "aws_s3_bucket_ownership_controls" "logging" {
  bucket = "${local.bucket_stem}-logs"

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "logging" {
  block_public_acls       = true
  block_public_policy     = true
  bucket                  = "${local.bucket_stem}-logs"
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logging" {
  bucket = "${local.bucket_stem}-logs"

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "logging" {
  bucket = "${local.bucket_stem}-logs"

  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "logging_bucket" {
  statement {
    sid = "RequireTls"

    actions = ["s3:*"]
    effect  = "Deny"
    resources = [
      local.logging_bucket_arn,
      "${local.logging_bucket_arn}/*",
    ]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "Bool"
      values   = ["false"]
      variable = "aws:SecureTransport"
    }
  }

  statement {
    sid = "PermitS3AccessLogDelivery"

    actions   = ["s3:PutObject"]
    effect    = "Allow"
    resources = ["${local.logging_bucket_arn}/access/*"]

    principals {
      identifiers = ["logging.s3.amazonaws.com"]
      type        = "Service"
    }

    condition {
      test     = "ArnLike"
      values   = [local.custody_bucket_arn]
      variable = "aws:SourceArn"
    }

    condition {
      test     = "StringEquals"
      values   = [var.aws_account_id]
      variable = "aws:SourceAccount"
    }
  }
}

resource "aws_s3_bucket_policy" "logging" {
  bucket = "${local.bucket_stem}-logs"
  policy = data.aws_iam_policy_document.logging_bucket.json
}

resource "aws_s3_bucket" "custody" {
  bucket = "${local.bucket_stem}-custody"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "${local.name_prefix}-custody"
    Authority = "none"
  }
}

resource "aws_s3_bucket_ownership_controls" "custody" {
  bucket = "${local.bucket_stem}-custody"

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "custody" {
  block_public_acls       = true
  block_public_policy     = true
  bucket                  = "${local.bucket_stem}-custody"
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "custody" {
  bucket = "${local.bucket_stem}-custody"

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.custody.arn
      sse_algorithm     = "aws:kms"
    }

    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "custody" {
  bucket = "${local.bucket_stem}-custody"

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "custody" {
  bucket = "${local.bucket_stem}-custody"

  rule {
    id     = "expire-captures-at-approved-maximum-age"
    status = "Enabled"

    filter {
      prefix = "captures/"
    }

    expiration {
      days = var.capture_retention_days - 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_logging" "custody" {
  bucket        = "${local.bucket_stem}-custody"
  target_bucket = "${local.bucket_stem}-logs"
  target_prefix = "access/"

  depends_on = [aws_s3_bucket_policy.logging]
}

data "aws_iam_policy_document" "custody_safety" {
  statement {
    sid = "RequireTls"

    actions = ["s3:*"]
    effect  = "Deny"
    resources = [
      local.custody_bucket_arn,
      "${local.custody_bucket_arn}/*",
    ]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "Bool"
      values   = ["false"]
      variable = "aws:SecureTransport"
    }
  }

  statement {
    sid = "RequireConditionalCreation"

    actions   = ["s3:PutObject"]
    effect    = "Deny"
    resources = ["${local.custody_bucket_arn}/*"]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "Null"
      values   = ["true"]
      variable = "s3:if-none-match"
    }
  }

  statement {
    sid = "RequireKmsEncryption"

    actions   = ["s3:PutObject"]
    effect    = "Deny"
    resources = ["${local.custody_bucket_arn}/*"]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "StringNotEquals"
      values   = ["aws:kms"]
      variable = "s3:x-amz-server-side-encryption"
    }
  }

  statement {
    sid = "RequireCustodyKmsKey"

    actions   = ["s3:PutObject"]
    effect    = "Deny"
    resources = ["${local.custody_bucket_arn}/*"]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "StringNotEquals"
      values   = [local.custody_key_alias_arn]
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
    }
  }

  statement {
    sid = "DenyUnreviewedDeletion"

    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]
    effect    = "Deny"
    resources = ["${local.custody_bucket_arn}/*"]

    principals {
      identifiers = ["*"]
      type        = "AWS"
    }

    condition {
      test     = "ArnNotEquals"
      values   = [local.retention_admin_role_arn]
      variable = "aws:PrincipalArn"
    }
  }
}

resource "aws_s3_bucket_policy" "custody_safety" {
  bucket = "${local.bucket_stem}-custody"
  policy = data.aws_iam_policy_document.custody_safety.json
}
