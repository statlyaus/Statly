locals {
  resource_environment = replace(var.environment, "_", "-")
  name_prefix          = "statly-afl-trade-${local.resource_environment}"
  availability_zones   = ["${var.aws_region}a", "${var.aws_region}b"]
  worker_subnets = {
    for index, zone in local.availability_zones : zone => cidrsubnet(var.vpc_cidr, 8, index + 16)
  }
  data_subnets = {
    for index, zone in local.availability_zones : zone => cidrsubnet(var.vpc_cidr, 8, index + 32)
  }
  vpc_resolver_cidr = "${cidrhost(var.vpc_cidr, 2)}/32"
}

resource "aws_vpc" "outcomes" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_subnet" "worker" {
  for_each = local.worker_subnets

  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-worker-${each.key}"
    Tier = "private-worker"
  }
}

resource "aws_subnet" "data" {
  for_each = local.data_subnets

  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-data-${each.key}"
    Tier = "isolated-data"
  }
}

resource "aws_route_table" "worker" {
  vpc_id = aws_vpc.outcomes.id
  route  = []

  tags = {
    Name = "${local.name_prefix}-worker-routes"
  }
}

resource "aws_route_table_association" "worker" {
  for_each = aws_subnet.worker

  route_table_id = aws_route_table.worker.id
  subnet_id      = each.value.id
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.outcomes.id
  route  = []

  tags = {
    Name = "${local.name_prefix}-data-routes"
  }
}

resource "aws_route_table_association" "data" {
  for_each = aws_subnet.data

  route_table_id = aws_route_table.data.id
  subnet_id      = each.value.id
}

resource "aws_vpc_endpoint" "s3" {
  route_table_ids   = [aws_route_table.worker.id]
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  vpc_id            = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-s3-endpoint"
  }
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

resource "aws_security_group" "worker" {
  description = "No-ingress dispatcher and capture worker security group"
  name        = "${local.name_prefix}-worker"
  vpc_id      = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-worker"
  }
}

resource "aws_security_group" "database" {
  description = "Isolated outcomes PostgreSQL security group"
  name        = "${local.name_prefix}-database"
  vpc_id      = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-database"
  }
}

resource "aws_security_group" "cache" {
  description = "Isolated admission and lease cache security group"
  name        = "${local.name_prefix}-cache"
  vpc_id      = aws_vpc.outcomes.id

  tags = {
    Name = "${local.name_prefix}-cache"
  }
}

resource "aws_vpc_security_group_egress_rule" "worker_dns_udp" {
  cidr_ipv4         = local.vpc_resolver_cidr
  description       = "VPC resolver DNS over UDP"
  from_port         = 53
  ip_protocol       = "udp"
  security_group_id = aws_security_group.worker.id
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "worker_dns_tcp" {
  cidr_ipv4         = local.vpc_resolver_cidr
  description       = "VPC resolver DNS over TCP"
  from_port         = 53
  ip_protocol       = "tcp"
  security_group_id = aws_security_group.worker.id
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "worker_database" {
  description                  = "PostgreSQL access from bounded workers"
  from_port                    = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.database.id
  security_group_id            = aws_security_group.worker.id
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "database_worker" {
  description                  = "PostgreSQL from bounded workers only"
  from_port                    = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
  security_group_id            = aws_security_group.database.id
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "worker_cache" {
  description                  = "TLS Redis access from bounded workers"
  from_port                    = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.cache.id
  security_group_id            = aws_security_group.worker.id
  to_port                      = 6379
}

resource "aws_vpc_security_group_egress_rule" "worker_s3" {
  description       = "HTTPS access to S3 through the regional gateway endpoint"
  from_port         = 443
  ip_protocol       = "tcp"
  prefix_list_id    = data.aws_prefix_list.s3.id
  security_group_id = aws_security_group.worker.id
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "cache_worker" {
  description                  = "TLS Redis from bounded workers only"
  from_port                    = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
  security_group_id            = aws_security_group.cache.id
  to_port                      = 6379
}
