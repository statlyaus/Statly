#!/usr/bin/env Rscript
# Requires: fitzRoy, jsonlite, janitor, dplyr, stringr

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
season_arg <- Sys.getenv("SEASON",
  unset = ifelse(length(args) >= 1, args[[1]],
    format(Sys.Date(), "%Y")
  )
)
roundn <- as.integer(Sys.getenv("ROUND",
  unset = ifelse(length(args) >= 2, args[[2]], NA)
))
outfile <- Sys.getenv(
  "OUTFILE",
  unset = ifelse(
    length(args) >= 3,
    args[[3]],
    "player_stats_fryzigg.json"
  )
)

seasons <- as.integer(unlist(strsplit(season_arg, ",")))
seasons <- seasons[!is.na(seasons)]
if (length(seasons) == 0) {
  seasons <- as.integer(format(Sys.Date(), "%Y"))
}

# Pull Fryzigg data for one or more seasons
df <- fetch_player_stats_fryzigg(season = seasons)

# Clean names → snake_case; harmonise obvious columns
df <- janitor::clean_names(df)
df <- as.data.frame(df)
names(df) <- make.unique(names(df), sep = "_")

required_cols <- c(
  "time_on_ground_percentage",
  "percent_tog",
  "tog",
  "player_name",
  "player_first_name",
  "player_last_name",
  "match_home_team",
  "match_away_team",
  "team",
  "opposition",
  "kicks",
  "handballs",
  "disposals",
  "match_round",
  "round_1"
)
for (col in required_cols) {
  if (!(col %in% names(df))) {
    df[[col]] <- NA
  }
}

if ("round" %in% names(df) && "round_1" %in% names(df)) {
  df$round <- dplyr::coalesce(df$round, df$round_1)
  df$round_1 <- NULL
}

to_num <- function(x) {
  suppressWarnings(as.numeric(trimws(as.character(x))))
}

# Ensure season/round columns exist for downstream processing
if (!("season" %in% names(df))) {
  df$season <- seasons[[1]]
}
if (!("round" %in% names(df)) && ("match_round" %in% names(df))) {
  df$round <- df$match_round
}
if (!("round" %in% names(df))) {
  df$round <- NA_integer_
}

# Normalise likely column names across sources
rename_if_exists <- function(d, from, to) {
  if (from %in% names(d)) {
    names(d)[names(d) == from] <- to
  }
  d
}
df <- df %>%
  rename_if_exists("match_round", "round") %>%
  rename_if_exists("player_team", "team") %>%
  rename_if_exists("player_first_name", "player_first_name") %>%
  rename_if_exists("player_last_name", "player_last_name") %>%
  rename_if_exists("player", "player_name") %>%
  rename_if_exists("kick", "kicks") %>%
  rename_if_exists("hb", "handballs") %>%
  rename_if_exists("ho", "hit_outs") %>%
  rename_if_exists("hitouts", "hit_outs") %>%
  rename_if_exists("i50", "inside_50s") %>%
  rename_if_exists("r50", "rebound_50s") %>%
  { names(.) <- make.unique(names(.), sep = "_"); . } %>%
  mutate(
    season = as.integer(trimws(as.character(season))),
    round = as.integer(trimws(as.character(round))),
    player_name = coalesce(
      player_name,
      trimws(paste(player_first_name, player_last_name))
    ),
    opposition = case_when(
      !is.na(team) & team == match_home_team ~ match_away_team,
      !is.na(team) & team == match_away_team ~ match_home_team,
      TRUE ~ opposition
    ),
    kicks = to_num(kicks),
    handballs = to_num(handballs),
    disposals = coalesce(to_num(disposals), to_num(kicks) + to_num(handballs)),
    tog_pct = coalesce(
      to_num(time_on_ground_percentage),
      to_num(percent_tog),
      to_num(tog),
      na.default = NA_real_
    ),
    # rough 80m game
    minutes = ifelse(!is.na(tog_pct),
      round(100 * 0.8 * tog_pct / 100, 0), NA
    )
  )

# Write newline-delimited JSON to OUTFILE
con <- file(outfile, open = "w")
on.exit(close(con), add = TRUE)

for (i in seq_len(nrow(df))) {
  row <- df[i, , drop = FALSE]
  json_line <- jsonlite::toJSON(as.list(row), auto_unbox = TRUE)
  writeLines(json_line, con)
}
