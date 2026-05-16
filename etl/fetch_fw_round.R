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
current_season <- as.integer(format(Sys.Date(), "%Y"))
meta_outfile <- paste0(outfile, ".meta.json")

empty_like <- function(n = 0) {
  rep(NA, n)
}

fetch_source_df <- function(source_name, seasons) {
  if (source_name == "fryzigg") {
    return(fetch_player_stats_fryzigg(season = seasons))
  }
  if (source_name == "afltables") {
    return(fetch_player_stats_afltables(season = seasons))
  }
  if (source_name == "footywire_match") {
    match_ids_env <- Sys.getenv("FOOTYWIRE_MATCH_IDS", unset = "")
    match_ids <- as.integer(unlist(strsplit(match_ids_env, ",")))
    match_ids <- match_ids[!is.na(match_ids)]
    if (length(match_ids) == 0) {
      return(data.frame())
    }

    get_match_data_fn <- get("get_match_data", envir = asNamespace("fitzRoy"))
    rows <- lapply(match_ids, function(match_id) {
      tryCatch(get_match_data_fn(match_id), error = function(e) NULL)
    })

    non_null_rows <- rows[!vapply(rows, is.null, logical(1))]
    if (length(non_null_rows) == 0) {
      return(data.frame())
    }

    return(dplyr::bind_rows(non_null_rows))
  }
  stop(paste("Unsupported source", source_name))
}

select_sources <- function(seasons) {
  explicit_sources <- Sys.getenv("DATA_SOURCE", unset = "")
  if (nchar(trimws(explicit_sources)) > 0) {
    return(trimws(unlist(strsplit(explicit_sources, ","))))
  }

  if (max(seasons, na.rm = TRUE) >= current_season) {
    return(c("fryzigg", "afltables", "footywire_match"))
  }
  c("fryzigg")
}

to_num <- function(x) {
  suppressWarnings(as.numeric(trimws(as.character(x))))
}

to_chr <- function(x) {
  trimws(as.character(x))
}

parse_round_num <- function(x) {
  suppressWarnings(as.integer(gsub("[^0-9-]", "", trimws(as.character(x)))))
}

# Normalise likely column names across sources
rename_if_exists <- function(d, from, to) {
  if (from %in% names(d)) {
    names(d)[names(d) == from] <- to
  }
  d
}
normalize_source_df <- function(raw_df, source_name, seasons, roundn) {
  df <- janitor::clean_names(raw_df)
  df <- as.data.frame(df)
  names(df) <- make.unique(names(df), sep = "_")
  n_rows <- nrow(df)

  required_cols <- c(
    "time_on_ground_percentage",
    "time_on_ground",
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
    "rebound_50s",
    "rebounds",
    "frees_for",
    "frees_against",
    "disposal_efficiency",
    "match_round",
    "round_1",
    "round_2",
    "effective_disposals",
    "score_involvements",
    "metres_gained",
    "turnovers",
    "intercepts",
    "contested_possessions",
    "uncontested_possessions",
    "contested_marks",
    "one_percenters",
    "goal_assists",
    "inside_50s",
    "clearances",
    "clangers",
    "hit_outs"
  )
  for (col in required_cols) {
    if (!(col %in% names(df))) {
      df[[col]] <- empty_like(n_rows)
    }
  }

  if ("round" %in% names(df) && "round_1" %in% names(df)) {
    df$round <- dplyr::coalesce(df$round, df$round_1)
    df$round_1 <- NULL
  }

  if (!("season" %in% names(df))) {
    df$season <- rep(seasons[[1]], n_rows)
  }
  if (!("round" %in% names(df)) && ("match_round" %in% names(df))) {
    df$round <- df$match_round
  }
  if (!("round" %in% names(df))) {
    df$round <- rep(NA_integer_, n_rows)
  }

  df <- df %>%
    rename_if_exists("match_round", "round") %>%
    rename_if_exists("playing_for", "team") %>%
    rename_if_exists("home_team", "match_home_team") %>%
    rename_if_exists("away_team", "match_away_team") %>%
    rename_if_exists("player_team", "team") %>%
    rename_if_exists("first_name", "player_first_name") %>%
    rename_if_exists("last_name", "player_last_name") %>%
    rename_if_exists("surname", "player_last_name") %>%
    rename_if_exists("player", "player_name") %>%
    rename_if_exists("kick", "kicks") %>%
    rename_if_exists("hb", "handballs") %>%
    rename_if_exists("ho", "hit_outs") %>%
    rename_if_exists("hitouts", "hit_outs") %>%
    rename_if_exists("i50", "inside_50s") %>%
    rename_if_exists("r50", "rebound_50s") %>%
    rename_if_exists("free_kicks_for", "frees_for") %>%
    rename_if_exists("free_kicks_against", "frees_against") %>%
    rename_if_exists("disposal_efficiency_percentage", "disposal_efficiency") %>%
    rename_if_exists("ga", "goal_assists") %>%
    rename_if_exists("cp", "contested_possessions") %>%
    rename_if_exists("up", "uncontested_possessions") %>%
    rename_if_exists("ed", "effective_disposals") %>%
    rename_if_exists("de", "disposal_efficiency") %>%
    rename_if_exists("cm", "contested_marks") %>%
    rename_if_exists("si", "score_involvements") %>%
    rename_if_exists("mg", "metres_gained") %>%
    rename_if_exists("to", "turnovers") %>%
    rename_if_exists("itc", "intercepts") %>%
    rename_if_exists("k", "kicks") %>%
    rename_if_exists("d", "disposals") %>%
    rename_if_exists("m", "marks") %>%
    rename_if_exists("g", "goals") %>%
    rename_if_exists("b", "behinds") %>%
    rename_if_exists("t", "tackles") %>%
    rename_if_exists("cl", "clearances") %>%
    rename_if_exists("cg", "clangers") %>%
    rename_if_exists("ff", "frees_for") %>%
    rename_if_exists("fa", "frees_against") %>%
    { names(.) <- make.unique(names(.), sep = "_"); . } %>%
    mutate(
      season = as.integer(trimws(as.character(season))),
      round = coalesce(
        parse_round_num(round),
        parse_round_num(round_2)
      ),
      player_name = to_chr(player_name),
      player_first_name = to_chr(player_first_name),
      player_last_name = to_chr(player_last_name),
      team = to_chr(team),
      opposition = to_chr(opposition),
      match_home_team = to_chr(match_home_team),
      match_away_team = to_chr(match_away_team),
      player_name = coalesce(
        na_if(player_name, "NA"),
        na_if(trimws(paste(player_first_name, player_last_name)), "NA NA")
      ),
      opposition = case_when(
        !is.na(team) & team == match_home_team ~ match_away_team,
        !is.na(team) & team == match_away_team ~ match_home_team,
        TRUE ~ opposition
      ),
      kicks = to_num(kicks),
      handballs = to_num(handballs),
      disposals = coalesce(to_num(disposals), to_num(kicks) + to_num(handballs)),
      hit_outs = to_num(hit_outs),
      inside_50s = to_num(inside_50s),
      clearances = to_num(clearances),
      clangers = to_num(clangers),
      contested_possessions = to_num(contested_possessions),
      uncontested_possessions = to_num(uncontested_possessions),
      one_percenters = to_num(one_percenters),
      goal_assists = to_num(goal_assists),
      turnovers = to_num(turnovers),
      intercepts = to_num(intercepts),
      metres_gained = to_num(metres_gained),
      contested_marks = to_num(contested_marks),
      effective_disposals = to_num(effective_disposals),
      score_involvements = to_num(score_involvements),
      rebound_50s = coalesce(to_num(rebound_50s), to_num(rebounds)),
      frees_for = to_num(frees_for),
      frees_against = to_num(frees_against),
      disposal_efficiency = to_num(disposal_efficiency),
      tog_pct = coalesce(
        to_num(time_on_ground_percentage),
        to_num(time_on_ground),
        to_num(percent_tog),
        to_num(tog),
        na.default = NA_real_
      ),
      minutes = ifelse(!is.na(tog_pct),
        round(100 * 0.8 * tog_pct / 100, 0), NA
      ),
      source_name = source_name
    )

  if (!is.na(roundn)) {
    df <- df %>%
      filter(!is.na(round), round == roundn)
  }

  output_cols <- c(
    "season",
    "round",
    "team",
    "opposition",
    "player_name",
    "kicks",
    "handballs",
    "disposals",
    "marks",
    "tackles",
    "goals",
    "behinds",
    "hit_outs",
    "clearances",
    "inside_50s",
    "rebound_50s",
    "clangers",
    "contested_possessions",
    "uncontested_possessions",
    "frees_for",
    "frees_against",
    "one_percenters",
    "goal_assists",
    "turnovers",
    "intercepts",
    "metres_gained",
    "contested_marks",
    "effective_disposals",
    "score_involvements",
    "minutes",
    "tog_pct",
    "disposal_efficiency",
    "source_name"
  )

  df %>% select(any_of(output_cols))
}

source_names <- select_sources(seasons)
source_diagnostics <- list()
normalized_frames <- list()

for (source_name in source_names) {
  raw_df <- fetch_source_df(source_name, seasons)
  normalized_df <- normalize_source_df(raw_df, source_name, seasons, roundn)
  normalized_frames[[length(normalized_frames) + 1]] <- normalized_df
  source_diagnostics[[length(source_diagnostics) + 1]] <- list(
    source = source_name,
    seasons = seasons,
    requested_round = roundn,
    rows = nrow(normalized_df)
  )
}

df <- dplyr::bind_rows(normalized_frames)

writeLines(
  jsonlite::toJSON(
    list(
      sources = source_diagnostics,
      requested_round = roundn,
      total_rows = nrow(df)
    ),
    auto_unbox = TRUE
  ),
  meta_outfile
)

# Write newline-delimited JSON to OUTFILE
con <- file(outfile, open = "w")
on.exit(close(con), add = TRUE)

for (i in seq_len(nrow(df))) {
  row <- df[i, , drop = FALSE]
  json_line <- jsonlite::toJSON(as.list(row), auto_unbox = TRUE)
  writeLines(json_line, con)
}
