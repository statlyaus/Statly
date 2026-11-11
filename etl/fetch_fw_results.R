#!/usr/bin/env Rscript
# Requires: fitzRoy, jsonlite
#
# Emits one NDJSON row per completed Footywire match of a season (or its last N matches), in the
# shape etl/resultIngest.ts reads. Every fitzRoy failure, missing column or count mismatch stops the
# script with a non-zero exit, so the pipeline writes nothing. The last line,
# {"end_of_results": N}, tells the reader the output is complete.

RESULT_COLUMNS <- c("Date", "Round", "Home.Team", "Away.Team", "Home.Points", "Away.Points")

main <- function() {
  .libPaths("~/R/library")
  suppressPackageStartupMessages({
    library(fitzRoy)
    library(jsonlite)
  })

  args <- commandArgs(trailingOnly = TRUE)
  season <- as.integer(if (length(args) >= 1) args[[1]] else format(Sys.Date(), "%Y"))
  if (is.na(season)) stop("Season must be a year", call. = FALSE)
  last_n <- if (length(args) >= 2 && nzchar(args[[2]])) as.integer(args[[2]]) else NA_integer_
  if (length(args) >= 2 && nzchar(args[[2]]) && (is.na(last_n) || last_n < 1)) {
    stop("Last-match count must be a positive integer", call. = FALSE)
  }

  # fetch_results does not return Footywire's match id. It reads one match page per id from
  # Footywire's season match list, in list order, so the ids are read before and after it: a list
  # that changed in between (a match posted mid-run) could misalign them, and the run is refused.
  # fitzRoy does not export this reader; refuse to guess if it moves.
  if (!exists("fetch_footywire_match_ids", envir = asNamespace("fitzRoy"))) {
    stop("fitzRoy no longer provides fetch_footywire_match_ids", call. = FALSE)
  }
  fetch_match_ids <- get("fetch_footywire_match_ids", envir = asNamespace("fitzRoy"))
  ids_before <- fetch_match_ids(season)
  if (length(ids_before) == 0) stop("Footywire lists no completed matches for ", season, call. = FALSE)
  n <- if (is.na(last_n)) length(ids_before) else min(last_n, length(ids_before))

  results <- as.data.frame(fetch_results(season = season, source = "footywire", last_n_matches = n))
  ids_after <- fetch_match_ids(season)
  if (!identical(ids_before, ids_after)) {
    stop("Footywire's match list changed during the fetch; retry", call. = FALSE)
  }
  missing <- setdiff(RESULT_COLUMNS, names(results))
  if (length(missing) > 0) {
    stop("fitzRoy Footywire results are missing columns: ", paste(missing, collapse = ", "),
      call. = FALSE
    )
  }
  ids <- utils::tail(ids_before, n)
  if (nrow(results) != length(ids)) {
    stop("fitzRoy returned ", nrow(results), " results for ", length(ids), " Footywire matches",
      call. = FALSE
    )
  }

  # Finals are numbered on from the season's last home-and-away round, which the fixture names.
  fixture <- as.data.frame(fetch_fixture(season = season, source = "footywire"))
  if (!("Round.Name" %in% names(fixture))) {
    stop("fitzRoy Footywire fixture is missing Round.Name", call. = FALSE)
  }
  numbered <- grepl("^Round [0-9]+$", trimws(fixture$Round.Name))
  if (!any(numbered)) stop("Footywire fixture has no numbered round for ", season, call. = FALSE)
  last_home_and_away_round <- max(as.integer(sub("^Round ", "", trimws(fixture$Round.Name[numbered]))))

  for (i in seq_len(nrow(results))) {
    row <- list(
      season = season,
      match_id = ids[[i]],
      round_label = trimws(results$Round[[i]]),
      home_team = trimws(results$Home.Team[[i]]),
      away_team = trimws(results$Away.Team[[i]]),
      home_points = results$Home.Points[[i]],
      away_points = results$Away.Points[[i]],
      date = format(results$Date[[i]], "%Y-%m-%d"),
      last_home_and_away_round = last_home_and_away_round
    )
    cat(jsonlite::toJSON(row, auto_unbox = TRUE, na = "null"), "\n", sep = "")
  }
  # The reader stores nothing without this line, so output cut short by a failure writes nothing.
  cat(jsonlite::toJSON(list(end_of_results = nrow(results)), auto_unbox = TRUE), "\n", sep = "")
}

if (sys.nframe() == 0) main()
