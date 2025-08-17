#!/usr/bin/env Rscript
# Script: backfill_2025.R
# Purpose: Backfill all available 2025 AFL season data
# Usage: Rscript backfill_2025.R

# Set up library path for user-installed packages
.libPaths("~/R/library")

suppressPackageStartupMessages({
  library(fitzRoy)
  library(jsonlite)
  library(janitor)
  library(dplyr)
  library(stringr)
})

cat("🏈 Starting AFL 2025 season backfill...\n", file = stderr())

# Fetch all 2025 player stats
cat("📊 Fetching 2025 AFL player stats from fitzRoy...\n",
  file = stderr()
)
stats_2025 <- fetch_player_stats(season = 2025, source = "footywire")

cat("✅ Retrieved", nrow(stats_2025), "player records\n", file = stderr())
cat("📋 Rounds available:", paste(unique(stats_2025$Round), collapse = ", "),
  "\n",
  file = stderr()
)

# Clean and standardize the data for ETL processing
stats_clean <- stats_2025 %>%
  # Clean column names to snake_case
  clean_names() %>%
  # Extract round number from "Round X" format
  mutate(
    round_num = as.integer(str_extract(round, "\\d+")),
    # Handle "Round 0" (pre-season)
    round_num = ifelse(is.na(round_num), 0, round_num), 
    # Standardize player name column
    player_name = player,
    # Standardize team names
    team = case_when(
      team == "Richmond Tigers" ~ "Richmond",
      team == "Carlton Blues" ~ "Carlton",
      team == "Melbourne Demons" ~ "Melbourne",
      team == "Western Bulldogs" ~ "Western Bulldogs",
      team == "Adelaide Crows" ~ "Adelaide",
      team == "Brisbane Lions" ~ "Brisbane",
      team == "Gold Coast Suns" ~ "Gold Coast",
      team == "Greater Western Sydney Giants" ~ "GWS",
      team == "Hawthorn Hawks" ~ "Hawthorn",
      team == "North Melbourne Kangaroos" ~ "North Melbourne",
      team == "Port Adelaide Power" ~ "Port Adelaide",
      team == "St Kilda Saints" ~ "St Kilda",
      team == "Sydney Swans" ~ "Sydney",
      team == "West Coast Eagles" ~ "West Coast",
      team == "Essendon Bombers" ~ "Essendon",
      team == "Collingwood Magpies" ~ "Collingwood",
      team == "Geelong Cats" ~ "Geelong",
      team == "Fremantle Dockers" ~ "Fremantle",
      TRUE ~ team
    ),
    # Calculate player value (simplified scoring system)
    player_value = (d * 2) + (k * 3) + (hb * 2) + (m * 4) +
      (g * 6) + (b * 1) + (t * 4) + (ho * 1) +
      (i50 * 1) + (r50 * 1)
  ) %>%
  # Filter out pre-season games (Round 0) and focus on regular season
  filter(round_num > 0) %>%
  # Select relevant columns for ETL
  select(
    date, season,
    round = round_num, venue, player_name, team, opposition,
    match_id, disposals = d, kicks = k, handballs = hb, marks = m,
    goals = g, behinds = b, tackles = t, hitouts = ho, inside_50s = i50,
    rebound_50s = r50, clangers = cl, contested_possessions = cp,
    uncontested_possessions = up, effective_disposals = ed,
    disposal_efficiency = de, contested_marks = cm, intercepts = itc,
    player_value, supercoach_score = sc
  )

cat("🧹 Cleaned data:", nrow(stats_clean), "records\n", file = stderr())
cat("🎯 Rounds included:",
  paste(sort(unique(stats_clean$round)), collapse = ", "),
  "\n",
  file = stderr()
)

# Convert to NDJSON format for ETL processing
cat("📤 Converting to NDJSON format...\n", file = stderr())

# Process in chunks to handle large dataset
chunk_size <- 500
total_records <- nrow(stats_clean)
chunks <- ceiling(total_records / chunk_size)

for (i in 1:chunks) {
  start_idx <- (i - 1) * chunk_size + 1
  end_idx <- min(i * chunk_size, total_records)

  chunk_data <- stats_clean[start_idx:end_idx, ]

  # Output each row as NDJSON
  for (j in seq_len(nrow(chunk_data))) {
    # Convert single row to JSON object (not array)
    row_json <- toJSON(chunk_data[j, ],
      auto_unbox = TRUE,
      na = "null",
      dataframe = "rows"
    )
    # Remove array wrapper - convert [{"key":"value"}] to {"key":"value"}
    row_json <- gsub("^\\[|\\]$", "", row_json)
    cat(row_json, "\n")
  }

  # Progress indicator (to stderr so it doesn't interfere with NDJSON output)
  if (i %% 10 == 0 || i == chunks) {
    cat("📊 Progress:", round((end_idx / total_records) * 100, 1),
      "% (", end_idx, "/", total_records, ")\n",
      file = stderr()
    )
  }
}

cat("✅ Backfill complete! Processed", total_records, "records\n", 
    file = stderr())
