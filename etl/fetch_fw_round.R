#!/usr/bin/env Rscript
# Requires: fitzRoy, jsonlite, janitor, dplyr, stringr
library(data.table)

# Set up library path for user-installed packages
.libPaths("~/R/library")

suppressPackageStartupMessages({
  library(fitzRoy)
  library(jsonlite)
  library(janitor)
  library(dplyr)
  library(stringr)
})

args <- commandArgs(trailingOnly = TRUE)
season <- as.integer(Sys.getenv("SEASON", unset = ifelse(length(args) >= 1, args[[1]], format(Sys.Date(), "%Y"))))
roundn <- as.integer(Sys.getenv("ROUND",
  unset = ifelse(length(args) >= 2, args[[2]], NA)
))
outfile <- Sys.getenv(
  "OUTFILE",
  unset = ifelse(
    length(args) >= 3,
    args[[3]],
    "player_stats_footywire.json"
  )
)

# Pull latest for a season/round; if round is NA, fitzRoy returns latest round
df <- fetch_player_stats(
  season = if (!is.na(season)) season else NULL,
  round_number = if (!is.na(roundn)) roundn else NULL,
  source = "footywire"
)

# Clean names → snake_case; harmonise obvious columns
df <- janitor::clean_names(df)

# Normalise likely column names across sources
rename_if_exists <- function(d, from, to) {
  if (from %in% names(d)) {
    names(d)[names(d) == from] <- to
  }
  d
}
df <- df %>%
  rename_if_exists("team", "team") %>%
  rename_if_exists("player", "player_name") %>%
  rename_if_exists("kick", "kicks") %>%
  rename_if_exists("hb", "handballs") %>%
  rename_if_exists("ho", "hit_outs") %>%
  rename_if_exists("i50", "inside_50s") %>%
  rename_if_exists("r50", "rebound_50s") %>%
  mutate(
    disposals = coalesce(disposals, kicks + handballs),
    tog_pct = coalesce(percent_tog, tog, na.default = NA_real_),
    # rough 80m game
    minutes = ifelse(!is.na(tog_pct),
      round(100 * 0.8 * tog_pct / 100, 0), NA
    )
  )

# Minimal export fields
keep <- c(
  "season", "round", "team", "opposition", "player_name",
  "kicks", "handballs", "disposals", "marks", "tackles",
  "goals", "behinds", "hit_outs", "clearances", "inside_50s", "rebound_50s",
  "clangers", "contested_possessions", "uncontested_possessions",
  "frees_for", "frees_against", "one_percenters", "goal_assists", "turnovers",
  "intercepts", "metres_gained", "contested_marks", "effective_disposals",
  "score_involvements", "minutes", "tog_pct"
)

df <- df %>% select(any_of(keep))

# Write newline-delimited JSON to STDOUT (not file)
# Each row becomes one JSON line with original data preserved
apply(df, 1, function(row) {
  json_line <- jsonlite::toJSON(as.list(row), auto_unbox = TRUE)
  cat(json_line, "\n", sep = "")
})
