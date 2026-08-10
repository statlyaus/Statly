#!/usr/bin/env Rscript

if (!requireNamespace("jsonlite", quietly = TRUE) || !requireNamespace("digest", quietly = TRUE)) {
  stop("Pinned jsonlite and digest packages are required.")
}

script_dir <- dirname(normalizePath(sub("^--file=", "", commandArgs(FALSE)[grep("^--file=", commandArgs(FALSE))])))
decoder <- file.path(script_dir, "decode_fitzroy_capture.R")
working <- tempfile("statly-fitroy-decode-test-")
dir.create(working)
on.exit(unlink(working, recursive = TRUE, force = TRUE), add = TRUE)

rds_path <- file.path(working, "fixture.rds")
context_path <- file.path(working, "context.json")
output_path <- file.path(working, "output.json")
lock_sha <- paste(rep("a", 64), collapse = "")
image_digest <- paste0("sha256:", paste(rep("b", 64), collapse = ""))

fixture <- data.frame(
  integer_value = c(0L, NA_integer_),
  double_value = c(-0, NaN),
  text_value = c("Mārtiņš", NA_character_),
  factor_value = factor(c("one", "two"), levels = c("one", "two")),
  date_value = as.Date(c("2026-01-01", NA)),
  datetime_value = as.POSIXct(c("2026-01-01 12:34:56", NA), tz = "UTC"),
  stringsAsFactors = FALSE,
  row.names = c("source-1", "source-2")
)
saveRDS(fixture, rds_path, version = 3L, compress = FALSE)
rds_bytes <- readBin(rds_path, "raw", n = file.info(rds_path)$size)

sha <- function(character) paste(rep(character, 64), collapse = "")
context <- list(
  captureReceiptSha256 = sha("1"),
  capabilityId = "official-afl-player-stats",
  fitzRoyVersion = "1.7.0",
  authorizationCompetition = "AFLM",
  authorizationSeason = 2026L,
  invocationSha256 = sha("2"),
  diagnosticsSha256 = sha("3"),
  sourceRdsSha256 = digest::digest(rds_bytes, algo = "sha256", serialize = FALSE),
  invocationArgumentsSha256 = sha("4"),
  sourceSchemaSha256 = sha("5"),
  dependencyLockSha256 = lock_sha,
  imageDigest = image_digest,
  expectedRowCount = 2L,
  maximumRows = 10L,
  maximumFields = 20L,
  maximumCells = 200L,
  maximumCellBytes = 1024L,
  maximumOutputBytes = 1048576L
)
writeBin(charToRaw(jsonlite::toJSON(context, auto_unbox = TRUE)), context_path)

status <- system2(
  "Rscript",
  c("--vanilla", shQuote(decoder), shQuote(rds_path), shQuote(context_path), shQuote(output_path)),
  env = c(
    paste0("STATLY_R_LOCK_SHA256=", lock_sha),
    paste0("STATLY_CAPTURE_IMAGE_DIGEST=", image_digest)
  ),
  stdout = FALSE,
  stderr = FALSE
)
stopifnot(status == 0L)
decoded <- jsonlite::fromJSON(output_path, simplifyVector = FALSE)
stopifnot(identical(decoded$schemaVersion, "afl-trade-fitzroy-decoded-table/v1"))
stopifnot(length(decoded$rows) == 2L)
stopifnot(length(decoded$fields) == 6L)
stopifnot(is.null(names(decoded$fields)))
stopifnot(identical(decoded$fields[[1L]]$name, "integer_value"))
stopifnot(is.null(names(decoded$rows[[1L]])))
stopifnot(identical(decoded$rows[[1L]][[2L]]$kind, "finite_number"))
stopifnot(identical(decoded$rows[[1L]][[2L]]$value, "-0"))
stopifnot(identical(decoded$rows[[2L]][[2L]]$kind, "nan"))
stopifnot(identical(decoded$rows[[1L]][[4L]]$kind, "factor"))
stopifnot(identical(decoded$rows[[1L]][[5L]]$rawDays, "20454"))
stopifnot(!is.null(decoded$rows[[1L]][[6L]]$epochSeconds))
stopifnot(identical(unlist(decoded$frame$rowNames), c("source-1", "source-2")))

context$expectedRowCount <- 1L
writeBin(charToRaw(jsonlite::toJSON(context, auto_unbox = TRUE)), context_path)
subset_status <- system2(
  "Rscript",
  c("--vanilla", shQuote(decoder), shQuote(rds_path), shQuote(context_path), shQuote(output_path)),
  env = c(
    paste0("STATLY_R_LOCK_SHA256=", lock_sha),
    paste0("STATLY_CAPTURE_IMAGE_DIGEST=", image_digest)
  ),
  stdout = FALSE,
  stderr = FALSE
)
stopifnot(subset_status != 0L)

cat("fitzRoy decoder contract verified\n")
