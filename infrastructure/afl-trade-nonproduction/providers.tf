provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = merge(
      var.tags,
      {
        Application = "statly-afl-trade-intelligence"
        Authority   = "none"
        Environment = var.environment
        ManagedBy   = "opentofu"
        Stage       = "2A"
      }
    )
  }
}
