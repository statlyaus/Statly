resource "aws_kms_key" "database" {
  description             = "AFL trade non-production PostgreSQL encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-database"
  }
}

resource "aws_kms_alias" "database" {
  name          = "alias/${local.name_prefix}-database"
  target_key_id = aws_kms_key.database.key_id
}

resource "aws_db_subnet_group" "outcomes" {
  description = "Isolated AFL trade outcomes PostgreSQL subnets"
  name        = "${local.name_prefix}-database"
  subnet_ids  = [for subnet in aws_subnet.data : subnet.id]

  tags = {
    Name = "${local.name_prefix}-database"
  }
}

resource "aws_db_parameter_group" "outcomes" {
  description = "AFL trade outcomes PostgreSQL 16 parameters"
  family      = "postgres16"
  name        = "${local.name_prefix}-postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "outcomes" {
  allocated_storage                   = 20
  allow_major_version_upgrade         = false
  apply_immediately                   = false
  auto_minor_version_upgrade          = true
  backup_retention_period             = var.database_backup_retention_days
  backup_window                       = "15:00-16:00"
  copy_tags_to_snapshot               = true
  db_name                             = "afl_trade_outcomes"
  db_subnet_group_name                = aws_db_subnet_group.outcomes.name
  delete_automated_backups            = false
  deletion_protection                 = true
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  engine                              = "postgres"
  engine_version                      = "16"
  final_snapshot_identifier           = "${local.name_prefix}-postgres-final"
  iam_database_authentication_enabled = true
  identifier                          = "${local.name_prefix}-postgres"
  instance_class                      = var.database_instance_class
  kms_key_id                          = aws_kms_key.database.arn
  maintenance_window                  = "Sun:16:00-Sun:17:00"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = aws_kms_key.database.arn
  max_allocated_storage               = 100
  multi_az                            = true
  parameter_group_name                = aws_db_parameter_group.outcomes.name
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.database.arn
  port                                = 5432
  publicly_accessible                 = false
  skip_final_snapshot                 = false
  storage_encrypted                   = true
  storage_type                        = "gp3"
  username                            = "afl_trade_migration"
  vpc_security_group_ids              = [aws_security_group.database.id]

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "${local.name_prefix}-postgres"
    Authority = "none"
  }
}

resource "aws_kms_key" "cache" {
  description             = "AFL trade non-production Redis encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-cache"
  }
}

resource "aws_kms_alias" "cache" {
  name          = "alias/${local.name_prefix}-cache"
  target_key_id = aws_kms_key.cache.key_id
}

resource "aws_elasticache_subnet_group" "admission" {
  description = "Isolated AFL trade admission and lease cache subnets"
  name        = "${local.name_prefix}-cache"
  subnet_ids  = [for subnet in aws_subnet.data : subnet.id]

  tags = {
    Name = "${local.name_prefix}-cache"
  }
}

resource "aws_elasticache_parameter_group" "admission" {
  description = "AFL trade provider admission Redis parameters"
  family      = "redis7"
  name        = "${local.name_prefix}-redis7"
}

resource "aws_elasticache_user" "default" {
  access_string = "off ~* -@all"
  engine        = "redis"
  user_id       = "${local.name_prefix}-default"
  user_name     = "default"

  authentication_mode {
    type = "no-password-required"
  }

  tags = {
    Name = "${local.name_prefix}-cache-default-disabled"
  }
}

resource "aws_elasticache_user" "capture" {
  access_string = join(" ", [
    "on",
    "~afl-trade:*",
    "+get",
    "+set",
    "+pttl",
    "+del",
    "+eval",
    "+ping",
    "+info",
    "+client|setname",
    "+client|setinfo",
  ])
  engine    = "redis"
  user_id   = "${local.name_prefix}-capture"
  user_name = "afl-trade-capture"

  authentication_mode {
    type = "iam"
  }

  tags = {
    Name = "${local.name_prefix}-cache-capture"
  }
}

resource "aws_elasticache_user_group" "admission" {
  engine        = "redis"
  user_group_id = "${local.name_prefix}-admission"
  user_ids = [
    aws_elasticache_user.default.user_id,
    aws_elasticache_user.capture.user_id,
  ]

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name = "${local.name_prefix}-admission"
  }
}

resource "aws_elasticache_replication_group" "admission" {
  apply_immediately          = false
  at_rest_encryption_enabled = true
  automatic_failover_enabled = true
  auto_minor_version_upgrade = true
  description                = "AFL trade provider admission, cooldown and lease coordination"
  engine                     = "redis"
  engine_version             = "7.1"
  kms_key_id                 = aws_kms_key.cache.arn
  maintenance_window         = "sun:17:00-sun:18:00"
  multi_az_enabled           = true
  node_type                  = var.cache_node_type
  num_cache_clusters         = 2
  parameter_group_name       = aws_elasticache_parameter_group.admission.name
  port                       = 6379
  replication_group_id       = "${local.name_prefix}-admission"
  security_group_ids         = [aws_security_group.cache.id]
  snapshot_retention_limit   = 7
  snapshot_window            = "14:00-15:00"
  subnet_group_name          = aws_elasticache_subnet_group.admission.name
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  user_group_ids             = [aws_elasticache_user_group.admission.user_group_id]

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "${local.name_prefix}-admission"
    Authority = "none"
  }
}
