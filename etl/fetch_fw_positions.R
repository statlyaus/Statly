#!/usr/bin/env Rscript
# Fetch each AFL club's current list from Footywire (through fitzRoy) and write one NDJSON line
# per player: {"team", "first_name", "surname", "position_1", "position_2"} on stdout.
#
# Footywire lists a primary and an optional secondary playing position (Defender, Midfield,
# Ruck or Forward). Statly maps these to DEF/MID/RUC/FWD in
# src/server/players/footywirePositions.ts.
#
# Requires: fitzRoy, jsonlite. Fails (non-zero exit) if any club cannot be fetched.

suppressPackageStartupMessages({
  library(fitzRoy)
  library(jsonlite)
})

# Club label written to the output = name fitzRoy's Footywire lookup accepts.
clubs <- c(
  "Adelaide" = "Adelaide", "Brisbane Lions" = "Brisbane Lions", "Carlton" = "Carlton",
  "Collingwood" = "Collingwood", "Essendon" = "Essendon", "Fremantle" = "Fremantle",
  "Geelong" = "Geelong", "Gold Coast" = "Gold Coast", "GWS" = "GWS", "Hawthorn" = "Hawthorn",
  "Melbourne" = "Melbourne", "North Melbourne" = "Kangaroos", "Port Adelaide" = "Port Adelaide",
  "Richmond" = "Richmond", "St Kilda" = "St Kilda", "Sydney" = "Sydney",
  "West Coast" = "West Coast", "Western Bulldogs" = "Western Bulldogs"
)

fetch_club <- function(lookup, attempts = 3) {
  for (attempt in seq_len(attempts)) {
    details <- tryCatch(
      suppressMessages(fetch_player_details(lookup, current = TRUE, source = "footywire")),
      error = function(error) {
        message("Attempt ", attempt, " failed for ", lookup, ": ", conditionMessage(error))
        NULL
      }
    )
    if (!is.null(details) && nrow(details) > 0) return(details)
    Sys.sleep(2 * attempt)
  }
  NULL
}

value_or_null <- function(value) {
  if (is.null(value) || length(value) == 0 || is.na(value)) return(NULL)
  text <- trimws(as.character(value))
  if (!nzchar(text)) NULL else text
}

failures <- character(0)
for (club in names(clubs)) {
  details <- fetch_club(clubs[[club]])
  if (is.null(details)) {
    failures <- c(failures, club)
    next
  }
  for (index in seq_len(nrow(details))) {
    row <- details[index, ]
    record <- list(
      team = club,
      first_name = value_or_null(row[["first_name"]]),
      surname = value_or_null(row[["surname"]]),
      position_1 = value_or_null(row[["Position_1"]]),
      position_2 = value_or_null(row[["Position_2"]])
    )
    cat(toJSON(record, auto_unbox = TRUE, null = "null"), "\n", sep = "")
  }
  Sys.sleep(1)
}

if (length(failures) > 0) {
  message("Clubs that failed: ", paste(failures, collapse = ", "))
  quit(status = 1)
}
