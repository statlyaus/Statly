#!/usr/bin/env Rscript

# This decoder runs only after exact RDS custody. It emits a typed interchange envelope without
# selecting provider fields, resolving identities, deriving metrics, or replacing missing values.

SCHEMA_VERSION <- "afl-trade-fitzroy-decoded-table/v1"
DECODER_VERSION <- "afl-trade-fitzroy-rds-decoder/v1"
FITZROY_VERSION <- "1.7.0"
EXPECTED_R_VERSION <- "4.5.1"

fail <- function(message) {
  cat(message, "\n", file = stderr(), sep = "")
  quit(status = 1L, save = "no")
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  fail("Usage: decode_fitzroy_capture.R <exact-source.rds> <decode-context.json> <decoded-table.json>")
}
if (!requireNamespace("jsonlite", quietly = TRUE) || !requireNamespace("digest", quietly = TRUE)) {
  fail("The pinned jsonlite and digest runtime packages are required.")
}

rds_path <- args[[1L]]
context_path <- args[[2L]]
output_path <- args[[3L]]

context_bytes <- readBin(context_path, what = "raw", n = file.info(context_path)$size)
context <- jsonlite::fromJSON(rawToChar(context_bytes), simplifyVector = FALSE)
required_context <- c(
  "captureReceiptSha256", "capabilityId", "fitzRoyVersion", "authorizationCompetition",
  "authorizationSeason", "invocationSha256", "diagnosticsSha256", "sourceRdsSha256",
  "invocationArgumentsSha256", "sourceSchemaSha256", "dependencyLockSha256", "imageDigest", "expectedRowCount", "maximumRows",
  "maximumFields", "maximumCells", "maximumCellBytes", "maximumOutputBytes"
)
if (!identical(sort(names(context)), sort(required_context))) fail("Decode context fields are invalid.")
if (!identical(context$fitzRoyVersion, FITZROY_VERSION)) fail("Decode context fitzRoy version mismatch.")
for (field in c("captureReceiptSha256", "sourceRdsSha256", "sourceSchemaSha256")) {
  if (!grepl("^[a-f0-9]{64}$", context[[field]])) fail(paste0("Invalid ", field, "."))
}
for (field in c("invocationSha256", "invocationArgumentsSha256", "diagnosticsSha256", "dependencyLockSha256")) {
  if (!grepl("^[a-f0-9]{64}$", context[[field]])) fail(paste0("Invalid ", field, "."))
}
if (!grepl("^sha256:[a-f0-9]{64}$", context$imageDigest)) fail("Invalid imageDigest.")
for (field in c("expectedRowCount", "maximumRows", "maximumFields", "maximumCells", "maximumCellBytes", "maximumOutputBytes")) {
  value <- context[[field]]
  if (length(value) != 1L || !is.numeric(value) || is.na(value) || value <= 0 || value != floor(value)) {
    fail(paste0("Invalid positive integer bound: ", field, "."))
  }
}
if (context$expectedRowCount > context$maximumRows) fail("Expected row count exceeds the decoder row bound.")
if (!identical(as.character(getRversion()), EXPECTED_R_VERSION)) fail("Decoder R version mismatch.")
if (!identical(Sys.getenv("STATLY_R_LOCK_SHA256"), context$dependencyLockSha256)) {
  fail("Decoder dependency-lock identity mismatch.")
}
if (!identical(Sys.getenv("STATLY_CAPTURE_IMAGE_DIGEST"), context$imageDigest)) {
  fail("Decoder image identity mismatch.")
}

rds_bytes <- readBin(rds_path, what = "raw", n = file.info(rds_path)$size)
actual_rds_sha <- digest::digest(rds_bytes, algo = "sha256", serialize = FALSE)
if (!identical(actual_rds_sha, context$sourceRdsSha256)) fail("Exact RDS digest mismatch.")

table <- readRDS(rds_path)
if (!is.data.frame(table) || ncol(table) == 0L) fail("Exact RDS must contain a non-empty-field data frame.")
if (anyDuplicated(names(table)) != 0L) fail("Exact RDS contains duplicate field names.")
if (nrow(table) > context$maximumRows || ncol(table) > context$maximumFields || nrow(table) * ncol(table) > context$maximumCells) {
  fail("Decoded table exceeds the approved row or cell bound.")
}
if (nrow(table) != context$expectedRowCount) fail("Decoded RDS row count does not match capture diagnostics.")
unexpected_frame_attributes <- setdiff(names(attributes(table)), c("names", "row.names", "class"))
if (length(unexpected_frame_attributes) > 0L) fail("Unsupported data-frame attributes are present.")

bounded_text <- function(value, label) {
  encoded <- enc2utf8(as.character(value))
  if (nchar(encoded, type = "bytes") > context$maximumCellBytes) {
    fail(paste0(label, " exceeds the approved cell-byte bound."))
  }
  encoded
}

timezone_of <- function(column) {
  timezone <- attr(column, "tzone", exact = TRUE)
  if (is.null(timezone) || length(timezone) == 0L) return(NULL)
  paste(as.character(timezone), collapse = "|")
}

field_description <- function(column, name) {
  if (is.list(column) && !inherits(column, "POSIXlt")) {
    fail(paste0("Unsupported list column: ", name, "."))
  }
  if (inherits(column, "integer64")) fail(paste0("Unsupported integer64 column: ", name, "."))
  unexpected_attributes <- setdiff(names(attributes(column)), c("class", "levels", "tzone"))
  if (length(unexpected_attributes) > 0L) fail(paste0("Unsupported column attributes: ", name, "."))
  if (nchar(name, type = "bytes") > context$maximumCellBytes) fail("Field name exceeds the approved byte bound.")
  if (is.factor(column) && any(nchar(enc2utf8(levels(column)), type = "bytes") > context$maximumCellBytes)) {
    fail(paste0("Factor level exceeds the approved byte bound: ", name, "."))
  }
  list(
    name = name,
    storageType = typeof(column),
    classes = unname(as.list(class(column))),
    levels = if (is.factor(column)) unname(as.list(levels(column))) else NULL,
    timezone = timezone_of(column)
  )
}

encode_scalar <- function(column, index, field_name) {
  value <- column[index]
  if (length(value) != 1L) fail(paste0("Non-scalar cell in field ", field_name, "."))

  if (is.factor(column)) {
    if (is.na(value)) return(list(kind = "missing"))
    return(list(
      kind = "factor",
      value = bounded_text(as.character(value), field_name),
      levelIndex = as.integer(unclass(value))
    ))
  }
  if (inherits(column, "Date")) {
    if (is.na(value)) return(list(kind = "missing"))
    return(list(
      kind = "date",
      value = format(value, "%Y-%m-%d"),
      rawDays = sprintf("%.17g", as.numeric(unclass(value)))
    ))
  }
  if (inherits(column, "POSIXct") || inherits(column, "POSIXlt")) {
    if (is.na(value)) return(list(kind = "missing"))
    timezone <- timezone_of(column)
    return(list(
      kind = "datetime",
      value = format(as.POSIXct(value), "%Y-%m-%dT%H:%M:%OS6%z", tz = if (is.null(timezone)) "UTC" else timezone),
      timezone = timezone,
      epochSeconds = sprintf("%.17g", as.numeric(as.POSIXct(value)))
    ))
  }
  if (is.logical(column)) {
    if (is.na(value)) return(list(kind = "missing"))
    return(list(kind = "logical", value = isTRUE(value)))
  }
  if (is.integer(column)) {
    if (is.na(value)) return(list(kind = "missing"))
    return(list(kind = "integer", value = as.character(value)))
  }
  if (is.numeric(column)) {
    if (is.nan(value)) return(list(kind = "nan"))
    if (is.na(value)) return(list(kind = "missing"))
    if (is.infinite(value)) {
      return(list(kind = if (value > 0) "positive_infinity" else "negative_infinity"))
    }
    numeric_text <- if (identical(value, 0) && is.infinite(1 / value) && (1 / value) < 0) "-0" else sprintf("%.17g", value)
    return(list(kind = "finite_number", value = numeric_text))
  }
  if (is.character(column)) {
    if (is.na(value)) return(list(kind = "missing"))
    return(list(kind = "text", value = bounded_text(value, field_name)))
  }
  fail(paste0("Unsupported R column type for field ", field_name, ": ", typeof(column), "."))
}

fields <- unname(Map(field_description, table, names(table)))
rows <- lapply(seq_len(nrow(table)), function(row_index) {
  unname(Map(function(column, field_name) encode_scalar(column, row_index, field_name), table, names(table)))
})

output <- list(
  schemaVersion = SCHEMA_VERSION,
  captureReceiptSha256 = context$captureReceiptSha256,
  capabilityId = context$capabilityId,
  fitzRoyVersion = FITZROY_VERSION,
  authorizationCompetition = context$authorizationCompetition,
  authorizationSeason = context$authorizationSeason,
  invocationSha256 = context$invocationSha256,
  invocationArgumentsSha256 = context$invocationArgumentsSha256,
  diagnosticsSha256 = context$diagnosticsSha256,
  sourceRdsSha256 = context$sourceRdsSha256,
  sourceSchemaSha256 = context$sourceSchemaSha256,
  decoderRuntime = list(
    decoderVersion = DECODER_VERSION,
    rVersion = as.character(getRversion()),
    dependencyLockSha256 = context$dependencyLockSha256,
    imageDigest = context$imageDigest
  ),
  frame = list(classes = unname(as.list(class(table))), rowNames = unname(as.list(rownames(table)))),
  fields = fields,
  rows = rows
)

json <- jsonlite::toJSON(output, auto_unbox = TRUE, null = "null", digits = NA, na = "null")
if (nchar(json, type = "bytes") > context$maximumOutputBytes) fail("Decoded output exceeds the approved byte bound.")
writeBin(charToRaw(enc2utf8(json)), output_path)
