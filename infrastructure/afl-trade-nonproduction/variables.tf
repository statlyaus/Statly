variable "aws_account_id" {
  description = "The exact AWS account that may own this isolated non-production stack."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 decimal digits."
  }
}

variable "aws_region" {
  description = "AWS region approved for the AFL trade non-production boundary."
  type        = string
  default     = "ap-southeast-2"

  validation {
    condition     = var.aws_region == "ap-southeast-2"
    error_message = "Stage 2A is approved only for ap-southeast-2."
  }
}

variable "environment" {
  description = "Authority environment represented by this stack."
  type        = string
  default     = "non_production"

  validation {
    condition     = var.environment == "non_production"
    error_message = "This stack must never represent production authority."
  }
}

variable "vpc_cidr" {
  description = "Private address space dedicated to the non-production outcomes stack."
  type        = string
  default     = "10.64.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr must be valid IPv4 CIDR with at least a /20 address space."
  }
}

variable "database_instance_class" {
  description = "RDS instance class for the isolated PostgreSQL 16 target."
  type        = string
  default     = "db.t4g.micro"

  validation {
    condition     = startswith(var.database_instance_class, "db.")
    error_message = "database_instance_class must be an RDS DB instance class."
  }
}

variable "database_backup_retention_days" {
  description = "Number of days that RDS retains automated backups."
  type        = number
  default     = 7

  validation {
    condition     = var.database_backup_retention_days >= 7 && var.database_backup_retention_days <= 35
    error_message = "database_backup_retention_days must be between 7 and 35 days."
  }
}

variable "enable_migration_secret_access" {
  description = "Create the exact migration-role grant only after the RDS-managed master-secret ARN exists in a separately reviewed plan."
  type        = bool
  default     = false
}

variable "capture_retention_days" {
  description = "Approved maximum age in days for current and noncurrent raw objects under captures/."
  type        = number

  validation {
    condition = (
      floor(var.capture_retention_days) == var.capture_retention_days &&
      var.capture_retention_days >= 2 &&
      var.capture_retention_days <= 3650
    )
    error_message = "capture_retention_days must be a whole number between 2 and 3650."
  }
}

variable "cache_node_type" {
  description = "ElastiCache node type for provider admission and lease coordination."
  type        = string
  default     = "cache.t4g.micro"

  validation {
    condition     = startswith(var.cache_node_type, "cache.")
    error_message = "cache_node_type must be an ElastiCache node type."
  }
}

variable "permissions_boundary_arn" {
  description = "Optional organization-managed permissions boundary applied to created IAM roles."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.permissions_boundary_arn == null ||
      can(regex("^arn:aws:iam::[0-9]{12}:policy/[A-Za-z0-9+=,.@_/-]+$", var.permissions_boundary_arn))
    )
    error_message = "permissions_boundary_arn must be null or an IAM policy ARN."
  }
}

variable "tags" {
  description = "Additional non-sensitive tags applied to every supported AWS resource."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for key, value in var.tags :
      length(key) > 0 && length(key) <= 128 && length(value) <= 256 && !startswith(key, "aws:")
    ])
    error_message = "Tag keys and values must satisfy AWS length rules and may not use aws: prefixes."
  }
}
