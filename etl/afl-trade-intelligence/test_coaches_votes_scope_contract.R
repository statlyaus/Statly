#!/usr/bin/env Rscript

if (!requireNamespace("fitzRoy", quietly = TRUE)) {
  stop("The pinned fitzRoy package is required.")
}

namespace <- asNamespace("fitzRoy")
function_name <- "scrape_coaches_votes"
original <- get(function_name, envir = namespace, inherits = FALSE)
calls <- list()
fake <- function(season = NULL, round_number = NULL, comp = "AFLM", finals) {
  calls[[length(calls) + 1L]] <<- list(
    season = season,
    round_number = round_number,
    comp = comp,
    finals = finals
  )
  data.frame(
    Season = as.integer(season),
    Round = as.integer(round_number),
    Home.Team = "Carlton",
    Away.Team = "Richmond",
    Player.Name = "Reviewed Player (CARL)",
    Coaches.Votes = "10",
    stringsAsFactors = FALSE
  )
}

unlockBinding(function_name, namespace)
assign(function_name, fake, envir = namespace)
lockBinding(function_name, namespace)
on.exit({
  unlockBinding(function_name, namespace)
  assign(function_name, original, envir = namespace)
  lockBinding(function_name, namespace)
}, add = TRUE)

captured <- fitzRoy::fetch_coaches_votes(
  season = 2025,
  round_number = c(23L, 24L),
  comp = "AFLM",
  award_scope = "home_and_away"
)

stopifnot(identical(
  names(captured),
  c("Season", "Round", "Award.Scope", "Home.Team", "Away.Team", "Player.Name", "Coaches.Votes")
))
stopifnot(identical(captured$Round, c(23L, 24L)))
stopifnot(identical(captured$Award.Scope, c("home_and_away", "home_and_away")))
stopifnot(length(calls) == 2L)
stopifnot(all(vapply(calls, function(call) identical(call$finals, FALSE), logical(1))))

invalid_scope <- try(
  fitzRoy::fetch_coaches_votes(
    season = 2025,
    round_number = 24L,
    comp = "AFLM",
    award_scope = "combined"
  ),
  silent = TRUE
)
stopifnot(inherits(invalid_scope, "try-error"))

cat("scoped fitzRoy coaches-votes contract verified\n")
