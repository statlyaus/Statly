#!/usr/bin/env Rscript
# Requires: fitzRoy, jsonlite

# fitzRoy's fetch_player_stats(source = "footywire") column names, mapped to the
# row fields etl/normalizePlayerRow.ts reads. Every column is required: if fitzRoy
# or Footywire stops returning one, the fetch fails instead of exporting gaps.
FOOTYWIRE_COLUMNS <- c(
  Season = "season",
  Round = "round",
  Team = "team",
  Opposition = "opposition",
  Player = "player_name",
  K = "kicks",
  HB = "handballs",
  D = "disposals",
  M = "marks",
  T = "tackles",
  G = "goals",
  B = "behinds",
  HO = "hit_outs",
  CL = "clearances",
  I50 = "inside_50s",
  R50 = "rebound_50s",
  CG = "clangers",
  CP = "contested_possessions",
  UP = "uncontested_possessions",
  FF = "frees_for",
  FA = "frees_against",
  One.Percenters = "one_percenters",
  GA = "goal_assists",
  TO = "turnovers",
  ITC = "intercepts",
  MG = "metres_gained",
  CM = "contested_marks",
  ED = "effective_disposals",
  SI = "score_involvements",
  TOG = "tog_pct"
)

# Footywire labels home-and-away rounds "Round N" and names finals. Each finals
# week is numbered on from the season's last home-and-away round (2025's Round 24
# is followed by finals rounds 25 to 28), the same rule etl/fixtureIngest.ts uses,
# so a final's stats carry the fixture's match_uid. An unknown label fails closed.
FOOTYWIRE_FINALS_WEEK <- c(
  "Qualifying Final" = 1L,
  "Elimination Final" = 1L,
  "Semi Final" = 2L,
  "Preliminary Final" = 3L,
  "Grand Final" = 4L
)

footywire_round_number <- function(label) {
  label <- trimws(as.character(label))
  numbered <- grepl("^Round [0-9]+$", label)
  out <- rep(NA_integer_, length(label))
  out[numbered] <- as.integer(sub("^Round ", "", label[numbered]))

  finals <- !numbered
  unknown <- unique(label[finals & !(label %in% names(FOOTYWIRE_FINALS_WEEK))])
  if (length(unknown) > 0) {
    stop("Unknown Footywire round: ", paste(unknown, collapse = ", "), call. = FALSE)
  }
  if (any(finals)) {
    if (!any(numbered)) {
      stop("Footywire stats have finals but no numbered home-and-away round", call. = FALSE)
    }
    out[finals] <- max(out[numbered]) + unname(FOOTYWIRE_FINALS_WEEK[label[finals]])
  }
  out
}

# fitzRoy returns every round of the season (it ignores round_number for
# Footywire), so keep the requested round, or the latest round (finals included).
footywire_export_rows <- function(df, round_number = NA_integer_) {
  df <- as.data.frame(df, stringsAsFactors = FALSE)
  missing <- setdiff(names(FOOTYWIRE_COLUMNS), names(df))
  if (length(missing) > 0) {
    stop(
      "fitzRoy Footywire output is missing required columns: ",
      paste(missing, collapse = ", "),
      call. = FALSE
    )
  }

  out <- df[, names(FOOTYWIRE_COLUMNS), drop = FALSE]
  names(out) <- unname(FOOTYWIRE_COLUMNS)
  out$round <- footywire_round_number(out$round)

  if (is.na(round_number)) {
    if (all(is.na(out$round))) {
      stop("fitzRoy Footywire output has no numbered rounds", call. = FALSE)
    }
    round_number <- max(out$round, na.rm = TRUE)
  }
  out <- out[!is.na(out$round) & out$round == round_number, , drop = FALSE]
  if (nrow(out) == 0) {
    stop("fitzRoy Footywire output has no rows for round ", round_number, call. = FALSE)
  }

  # rough 80-minute game
  out$minutes <- round(0.8 * out$tog_pct, 0)
  rownames(out) <- NULL
  out
}

main <- function() {
  # Set up library path for user-installed packages
  .libPaths("~/R/library")

  suppressPackageStartupMessages({
    library(fitzRoy)
    library(jsonlite)
  })

  args <- commandArgs(trailingOnly = TRUE)
  season <- as.integer(Sys.getenv("SEASON",
    unset = ifelse(length(args) >= 1, args[[1]],
      format(Sys.Date(), "%Y")
    )
  ))
  roundn <- as.integer(Sys.getenv("ROUND",
    unset = ifelse(length(args) >= 2, args[[2]], NA)
  ))

  df <- fetch_player_stats(
    season = if (!is.na(season)) season else NULL,
    source = "footywire"
  )
  df <- footywire_export_rows(df, roundn)

  # Write newline-delimited JSON to STDOUT (not file).
  # Subset the data frame one row at a time so mixed columns retain their native
  # numeric/character types; matrix-style row application coerces mixed columns.
  for (row_index in seq_len(nrow(df))) {
    row <- as.list(df[row_index, , drop = FALSE])
    json_line <- jsonlite::toJSON(row, auto_unbox = TRUE, na = "null")
    cat(json_line, "\n", sep = "")
  }
}

# Run only as a script, so tests can source the column mapping without fetching.
if (sys.nframe() == 0L) {
  main()
}
