#!/usr/bin/env Rscript

# This process preserves the exact object returned by one pinned, direct fitzRoy function. It does
# not normalize fields, fill missing values, derive statistics, write a database, or grant source
# permission. Network execution belongs behind Statly's Gate 0A capture coordinator.

CAPTURE_SCHEMA_VERSION <- "afl-trade-fitzroy-diagnostics/v1"
INVOCATION_SCHEMA_VERSION <- "afl-trade-fitzroy-invocation/v1"
FITZROY_VERSION <- "1.7.0"
R_VERSION <- "4.5.1"

capture_project <- Sys.getenv("STATLY_CAPTURE_RENV_PROJECT", unset = "")
if (nzchar(capture_project)) {
  if (!requireNamespace("renv", quietly = TRUE)) {
    cat("The pinned renv bootstrap package is unavailable.\n", file = stderr())
    quit(status = 1L, save = "no")
  }
  renv::load(project = capture_project, quiet = TRUE)
}

capabilities <- list(
  list(id = "official-afl-player-stats", function_name = "fetch_player_stats_afl", round = "supported"),
  list(id = "afl-tables-player-stats", function_name = "fetch_player_stats_afltables", round = "ignored_returns_season"),
  list(id = "footywire-player-stats", function_name = "fetch_player_stats_footywire", round = "ignored_returns_season"),
  list(id = "fryzigg-player-stats", function_name = "fetch_player_stats_fryzigg", round = "ignored_returns_season"),
  list(id = "official-afl-results", function_name = "fetch_results_afl", round = "supported"),
  list(id = "afl-tables-results", function_name = "fetch_results_afltables", round = "supported"),
  list(id = "official-afl-player-details", function_name = "fetch_player_details_afl", round = "not_applicable"),
  list(id = "afl-tables-player-details", function_name = "fetch_player_details_afltables", round = "not_applicable"),
  list(id = "footywire-player-details", function_name = "fetch_player_details_footywire", round = "not_applicable"),
  list(id = "aflca-coaches-votes", function_name = "fetch_coaches_votes", round = "supported"),
  list(id = "footywire-brownlow-awards", function_name = "fetch_awards_brownlow", round = "not_applicable"),
  list(id = "footywire-all-australian", function_name = "fetch_awards_allaustralian", round = "not_applicable"),
  list(id = "footywire-rising-star", function_name = "fetch_rising_star", round = "supported")
)

fail <- function(message) {
  cat(message, "\n", file = stderr(), sep = "")
  quit(status = 1L, save = "no")
}

require_runtime <- function(require_identity = TRUE) {
  if (as.character(getRversion()) != R_VERSION) {
    fail(paste0("Expected R ", R_VERSION, "; found ", as.character(getRversion()), "."))
  }
  if (!requireNamespace("fitzRoy", quietly = TRUE)) {
    fail("The pinned fitzRoy package is unavailable.")
  }
  if (as.character(utils::packageVersion("fitzRoy")) != FITZROY_VERSION) {
    fail(paste0("Expected fitzRoy ", FITZROY_VERSION, "."))
  }
  if (!requireNamespace("jsonlite", quietly = TRUE) || !requireNamespace("digest", quietly = TRUE)) {
    fail("The pinned jsonlite and digest runtime packages are required.")
  }
  if (require_identity) {
    lock_sha <- Sys.getenv("STATLY_R_LOCK_SHA256", unset = "")
    image_digest <- Sys.getenv("STATLY_CAPTURE_IMAGE_DIGEST", unset = "")
    if (!grepl("^[a-f0-9]{64}$", lock_sha)) fail("STATLY_R_LOCK_SHA256 is missing or invalid.")
    if (!grepl("^sha256:[a-f0-9]{64}$", image_digest)) {
      fail("STATLY_CAPTURE_IMAGE_DIGEST is missing or invalid.")
    }
  }
}

args <- commandArgs(trailingOnly = TRUE)
if (identical(args, "--describe-capabilities")) {
  cat(jsonlite::toJSON(capabilities, auto_unbox = TRUE), "\n", sep = "")
  quit(status = 0L, save = "no")
}
if (identical(args, "--verify-runtime")) {
  require_runtime(require_identity = FALSE)
  cat("fitzRoy capture runtime verified\n")
  quit(status = 0L, save = "no")
}
if (length(args) != 3L) {
  fail("Usage: capture_fitzroy.R <canonical-invocation.json> <exact-output.rds> <diagnostics.json>")
}

require_runtime(require_identity = TRUE)
invocation_path <- args[[1L]]
output_path <- args[[2L]]
diagnostics_path <- args[[3L]]
invocation_bytes <- readBin(invocation_path, what = "raw", n = file.info(invocation_path)$size)
invocation_sha <- digest::digest(invocation_bytes, algo = "sha256", serialize = FALSE)
invocation <- jsonlite::fromJSON(rawToChar(invocation_bytes), simplifyVector = FALSE)

required_names <- c(
  "schemaVersion", "capabilityId", "fitzRoyVersion", "provider", "directFunction",
  "authorizationSeason", "expectedCaptureOrigin", "arguments"
)
if (!identical(sort(names(invocation)), sort(required_names))) fail("Invocation fields do not match the closed contract.")
if (!identical(invocation$schemaVersion, INVOCATION_SCHEMA_VERSION)) fail("Unsupported invocation schema version.")
if (!identical(invocation$fitzRoyVersion, FITZROY_VERSION)) fail("Invocation fitzRoy version mismatch.")

capability_index <- which(vapply(capabilities, function(x) identical(x$id, invocation$capabilityId), logical(1)))
if (length(capability_index) != 1L) fail("Unknown fitzRoy capability.")
capability <- capabilities[[capability_index]]
if (!identical(capability$function_name, invocation$directFunction)) fail("Capability/function mismatch.")

call_args <- invocation$arguments
conditions <- list()
record_condition <- function(kind, condition) {
  conditions[[length(conditions) + 1L]] <<- list(kind = kind, message = conditionMessage(condition))
}

# fitzRoy 1.7.0 exports these two AFL Tables datasets but its direct function resolves them as bare
# namespace variables. R does not install lazy-data objects into the locked namespace, so the direct
# call otherwise fails before returning source evidence. Install a process-local copy of the unchanged
# direct function whose parent contains only the exact exported objects, then restore the namespace on
# every exit. The returned object and direct function body are not transformed.
with_afltables_data_bindings <- function(code) {
  expected_digests <- c(
    dictionary_afltables = "d9f797e79f11edd7ace541f178d68091c55286c9163f2c02e2a0b37109b951a8",
    mapping_afltables = "799966171a68b0562ebdeffc27ecb922a7c85d76bd5f041fbb0c413ebe091a9d"
  )
  bindings <- lapply(names(expected_digests), function(name) {
    value <- getExportedValue("fitzRoy", name)
    value_digest <- digest::digest(serialize(value, NULL, version = 3L), algo = "sha256", serialize = FALSE)
    if (!identical(value_digest, unname(expected_digests[[name]]))) {
      fail(paste0("Pinned fitzRoy AFL Tables compatibility data drifted: ", name, "."))
    }
    value
  })
  names(bindings) <- names(expected_digests)
  if (!is.data.frame(bindings$dictionary_afltables) ||
      !identical(names(bindings$dictionary_afltables), c("field", "data_type")) ||
      !is.character(bindings$mapping_afltables) || is.null(names(bindings$mapping_afltables))) {
    fail("Pinned fitzRoy AFL Tables compatibility data has an unsupported structure.")
  }

  namespace <- asNamespace("fitzRoy")
  function_name <- "fetch_player_stats_afltables"
  original <- getExportedValue("fitzRoy", function_name)
  compatibility_environment <- list2env(bindings, parent = environment(original))
  compatible <- original
  environment(compatible) <- compatibility_environment
  unlockBinding(function_name, namespace)
  assign(function_name, compatible, envir = namespace)
  lockBinding(function_name, namespace)
  on.exit({
    unlockBinding(function_name, namespace)
    assign(function_name, original, envir = namespace)
    lockBinding(function_name, namespace)
  }, add = TRUE)
  force(code)
}

# Deliberately explicit direct calls: no wrapper, source selector, or dynamic function dispatch.
result <- withCallingHandlers(
  switch(invocation$capabilityId,
    "official-afl-player-stats" = fitzRoy::fetch_player_stats_afl(
      season = call_args$season, round_number = call_args$round_number, comp = call_args$comp
    ),
    "afl-tables-player-stats" = with_afltables_data_bindings(
      fitzRoy::fetch_player_stats_afltables(
        season = call_args$season, round_number = NULL, rescrape = call_args$rescrape,
        rescrape_start_season = call_args$rescrape_start_season
      )
    ),
    "footywire-player-stats" = fitzRoy::fetch_player_stats_footywire(
      season = call_args$season, round_number = NULL, check_existing = call_args$check_existing
    ),
    "fryzigg-player-stats" = fitzRoy::fetch_player_stats_fryzigg(
      season = call_args$season, round_number = NULL, comp = call_args$comp
    ),
    "official-afl-results" = fitzRoy::fetch_results_afl(
      season = call_args$season, round_number = call_args$round_number, comp = call_args$comp
    ),
    "afl-tables-results" = fitzRoy::fetch_results_afltables(
      season = call_args$season, round_number = call_args$round_number
    ),
    "official-afl-player-details" = fitzRoy::fetch_player_details_afl(
      season = call_args$season, team = call_args$team, current = call_args$current,
      comp = call_args$comp, official_teams = call_args$official_teams
    ),
    "afl-tables-player-details" = fitzRoy::fetch_player_details_afltables(team = call_args$team),
    "footywire-player-details" = fitzRoy::fetch_player_details_footywire(
      team = call_args$team, current = call_args$current
    ),
    "aflca-coaches-votes" = fitzRoy::fetch_coaches_votes(
      season = call_args$season, round_number = call_args$round_number,
      comp = call_args$comp, team = call_args$team
    ),
    "footywire-brownlow-awards" = fitzRoy::fetch_awards_brownlow(
      season = call_args$season, type = call_args$type
    ),
    "footywire-all-australian" = fitzRoy::fetch_awards_allaustralian(
      season = call_args$season, type = call_args$type
    ),
    "footywire-rising-star" = fitzRoy::fetch_rising_star(
      season = call_args$season, round_number = call_args$round_number, type = call_args$type
    ),
    fail("Unknown fitzRoy capability.")
  ),
  warning = function(condition) {
    record_condition("warning", condition)
    invokeRestart("muffleWarning")
  },
  message = function(condition) {
    record_condition("message", condition)
    invokeRestart("muffleMessage")
  }
)

if (is.null(result) || !is.data.frame(result)) fail("fitzRoy capture returned NULL or a non-tabular object.")
saveRDS(result, file = output_path, version = 3L, compress = FALSE)

count_numeric <- function(column, predicate) {
  if (!is.numeric(column)) return(0L)
  as.integer(sum(predicate(column), na.rm = TRUE))
}
column_timezone <- function(column) {
  timezone <- attr(column, "tzone", exact = TRUE)
  if (is.null(timezone) || length(timezone) == 0L) return(NULL)
  paste(as.character(timezone), collapse = "|")
}
fields <- lapply(names(result), function(field_name) {
  column <- result[[field_name]]
  list(
    name = field_name,
    classes = unname(as.list(class(column))),
    storageType = typeof(column),
    missingCount = as.integer(sum(is.na(column))),
    nanCount = count_numeric(column, is.nan),
    positiveInfinityCount = count_numeric(column, function(x) is.infinite(x) & x > 0),
    negativeInfinityCount = count_numeric(column, function(x) is.infinite(x) & x < 0),
    levels = if (is.factor(column)) unname(as.list(levels(column))) else NULL,
    timezone = column_timezone(column)
  )
})

observed_values <- function(candidates) {
  matching <- names(result)[tolower(names(result)) %in% tolower(candidates)]
  if (length(matching) == 0L) return(list())
  values <- unique(unlist(lapply(matching, function(name) as.character(result[[name]])), use.names = FALSE))
  unname(as.list(sort(values[!is.na(values)])))
}
observed_date_range <- function() {
  matching <- names(result)[tolower(names(result)) %in% c("date", "match_date", "gamedate")]
  if (length(matching) == 0L) return(NULL)
  values <- unlist(lapply(matching, function(name) as.character(result[[name]])), use.names = FALSE)
  values <- suppressWarnings(as.Date(values))
  values <- values[!is.na(values)]
  if (length(values) == 0L) return(NULL)
  unname(as.list(as.character(range(values))))
}

diagnostics <- list(
  schemaVersion = CAPTURE_SCHEMA_VERSION,
  capabilityId = invocation$capabilityId,
  fitzRoyVersion = FITZROY_VERSION,
  directFunction = invocation$directFunction,
  invocationSha256 = invocation_sha,
  runtime = list(
    rVersion = as.character(getRversion()),
    platform = R.version$platform,
    dependencyLockSha256 = Sys.getenv("STATLY_R_LOCK_SHA256"),
    imageDigest = Sys.getenv("STATLY_CAPTURE_IMAGE_DIGEST")
  ),
  rowCount = nrow(result),
  duplicateRowCount = as.integer(sum(duplicated(result))),
  fields = fields,
  observedSeasonValues = observed_values(c("season", "year")),
  observedRoundValues = observed_values(c("round", "round_number", "roundnumber")),
  observedDateRange = observed_date_range(),
  originObservation = "not_exposed_by_fitzroy",
  conditions = conditions
)
writeLines(
  jsonlite::toJSON(diagnostics, auto_unbox = TRUE, null = "null", na = "null", digits = NA),
  con = diagnostics_path,
  useBytes = TRUE
)
