locals {
  configuration_source_files = [
    ".terraform.lock.hcl",
    "attestation.tf",
    "custody.tf",
    "data.tf",
    "iam.tf",
    "network.tf",
    "providers.tf",
    "review.tfrc",
    "variables.tf",
    "versions.tf",
  ]
  configuration_source_digest = sha256(join("", [
    for source_file in local.configuration_source_files : filesha256("${path.module}/${source_file}")
  ]))
}

resource "terraform_data" "configuration_attestation" {
  input = local.configuration_source_digest
}
