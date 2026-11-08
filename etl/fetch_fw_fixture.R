#!/usr/bin/env Rscript
# Requires: fitzRoy, jsonlite
#
# Emits one NDJSON row per Footywire fixture game for a season, in the shape
# etl/fixtureIngest.ts reads. Every fitzRoy failure stops the script with a
# non-zero exit, so the pipeline writes nothing.

FIXTURE_COLUMNS <- c("Date", "Season.Game", "Round.Name", "Home.Team", "Away.Team", "Venue")

main <- function() {
  .libPaths("~/R/library")
  suppressPackageStartupMessages({
    library(fitzRoy)
    library(jsonlite)
  })

  args <- commandArgs(trailingOnly = TRUE)
  season <- as.integer(if (length(args) >= 1) args[[1]] else format(Sys.Date(), "%Y"))
  if (is.na(season)) stop("Season must be a year", call. = FALSE)

  fixture <- as.data.frame(fetch_fixture(season = season, source = "footywire"))
  missing <- setdiff(FIXTURE_COLUMNS, names(fixture))
  if (length(missing) > 0) {
    stop("fitzRoy Footywire fixture is missing columns: ", paste(missing, collapse = ", "),
      call. = FALSE
    )
  }
  if (nrow(fixture) == 0) stop("fitzRoy returned no Footywire fixture for ", season, call. = FALSE)

  # Footywire links match stats only for completed games, in fixture order.
  # fitzRoy does not export this reader; refuse to guess if it moves.
  if (!exists("fetch_footywire_match_ids", envir = asNamespace("fitzRoy"))) {
    stop("fitzRoy no longer provides fetch_footywire_match_ids", call. = FALSE)
  }
  completed <- length(fitzRoy:::fetch_footywire_match_ids(season))

  for (i in seq_len(nrow(fixture))) {
    row <- list(
      season = season,
      season_game = fixture$Season.Game[[i]],
      round_label = fixture$Round.Name[[i]],
      home_team = fixture$Home.Team[[i]],
      away_team = fixture$Away.Team[[i]],
      venue = fixture$Venue[[i]],
      # fitzRoy parses Footywire's venue-local wall clock as UTC; print it back unchanged.
      local_start = format(fixture$Date[[i]], "%Y-%m-%d %H:%M:%S", tz = "UTC"),
      completed_match_count = completed
    )
    cat(jsonlite::toJSON(row, auto_unbox = TRUE, na = "null"), "\n", sep = "")
  }
}

if (sys.nframe() == 0) main()
