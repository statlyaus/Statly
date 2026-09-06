#!/usr/bin/env Rscript

# Offline public season-fetch contract: replace HTTP only, retain the real parser and pacer.
local({
  namespace <- asNamespace("curl")
  original <- get("curl_fetch_memory", namespace)
  replace_fetch <- function(value) {
    unlockBinding("curl_fetch_memory", namespace)
    assign("curl_fetch_memory", value, envir = namespace)
    lockBinding("curl_fetch_memory", namespace)
  }
  on.exit(replace_fetch(original), add = TRUE)
  scenario <- "reordered"
  table_html <- function(advanced, home) {
    names <- if (home) c("Chad Warner", "Corey Warner") else "Away Player"
    links <- if (home) c("pp-sydney-swans--chad-warner", "pp-sydney-swans--corey-warner") else "pp-away--player"
    values <- if (home) c("11", "22") else "33"
    if (advanced) {
      names <- if (home) rep("C Warner", 2) else "A Player"
      order <- rev(seq_along(names))
      names <- names[order]; links <- links[order]; values <- values[order]
    }
    if (home && advanced) {
      if (scenario == "unmatched") links[1] <- "pp-sydney-swans--other-player"
      if (scenario == "duplicate") links[1] <- links[2]
      if (scenario == "external") links[1] <- "https://other.example/afl/footy/pp-sydney-swans--corey-warner"
      if (scenario == "query") links[1] <- paste0(links[1], "?player=1")
      if (scenario == "fragment") links[1] <- paste0(links[1], "#player")
      if (scenario == "wrong_path") links[1] <- "/other/pp-sydney-swans--corey-warner"
      if (scenario == "missing_value") values[1] <- ""
      if (scenario == "absolute") links <- paste0("https://www.footywire.com/afl/footy/", links)
      if (scenario == "root_relative") links <- paste0("/afl/footy/", links)
    }
    if (home && !advanced && scenario == "duplicate_basic") links[1] <- links[2]
    headers <- if (advanced) "<th>GA</th><th>DE%</th><th>TOG%</th><th>1%</th><th>CP</th>" else "<th>GA</th><th>G</th>"
    rows <- vapply(seq_along(names), function(i) {
      stats <- if (advanced) paste0("<td>1</td><td>75</td><td>80</td><td>2</td><td>", values[i], "</td>") else "<td>1</td><td>3</td>"
      player <- paste0("<a href='", links[i], "'>", names[i], "</a>")
      if (home && advanced && i == 1L && scenario == "missing_link") player <- names[i]
      if (home && advanced && i == 1L && scenario == "multiple_links") player <- paste0(player, player)
      paste0("<tr><td>", player, "</td>", stats, "</tr>")
    }, character(1))
    paste0("<table><tr><th>Player</th>", headers, "</tr>", paste(rows, collapse = ""), "</table>")
  }
  match_html <- function(advanced) {
    empty <- "<table><tr><td>unused</td></tr></table>"
    paste0("<html><body><div class='notice'>Advanced statistics</div>",
      "<table class='lnormtop'><tr><td>Match</td></tr><tr><td class='lnorm'>Round 1, Test Oval</td></tr>",
      "<tr><td class='lnorm'>Saturday, 1 March 2025, 1 PM</td></tr></table>",
      "<table id='matchscoretable'><tr><td>Team</td></tr><tr><td><a>Sydney</a></td></tr>",
      "<tr><td><a>Away Club</a></td></tr></table>", paste(rep(empty, 10), collapse = ""),
      table_html(advanced, TRUE), paste(rep(empty, 4), collapse = ""), table_html(advanced, FALSE), "</body></html>")
  }
  replace_fetch(function(url, handle, ...) {
    body <- if (grepl("ft_match_list", url, fixed = TRUE)) {
      "<html><table><tr><td></td><td></td><td></td><td></td><td class='data'><a href='ft_match_statistics?mid=1'>Match</a></td></tr></table></html>"
    } else match_html(grepl("advv=Y", url, fixed = TRUE))
    list(status_code = 200L, content = charToRaw(body))
  })
  result <- suppressMessages(fitzRoy::fetch_player_stats_footywire(season = 2025, check_existing = FALSE))
  stopifnot(identical(result$Player, c("Chad Warner", "Corey Warner", "Away Player")))
  stopifnot(identical(result$CP, c(11, 22, 33)))
  stopifnot(identical(result$PlayerLink, c("pp-sydney-swans--chad-warner", "pp-sydney-swans--corey-warner", "pp-away--player")))
  cat("Reordered advanced rows joined by profile link, not abbreviated name or position\n")
  for (scenario in c("absolute", "root_relative", "missing_value")) {
    result <- suppressMessages(fitzRoy::fetch_player_stats_footywire(season = 2025, check_existing = FALSE))
    stopifnot(identical(result$PlayerLink, c("pp-sydney-swans--chad-warner", "pp-sydney-swans--corey-warner", "pp-away--player")))
    stopifnot(identical(result$CP, if (scenario == "missing_value") c(11, NA_real_, 33) else c(11, 22, 33)))
  }
  for (scenario in c("unmatched", "duplicate", "duplicate_basic", "external", "query", "fragment", "wrong_path", "missing_link", "multiple_links")) {
    failed <- tryCatch({
      suppressMessages(fitzRoy::fetch_player_stats_footywire(season = 2025, check_existing = FALSE))
      NULL
    }, error = identity)
    stopifnot(inherits(failed, "error"), grepl("FootyWire", conditionMessage(failed), fixed = TRUE))
  }
  cat("Link variants, missing values, duplicate/unmatched keys and invalid links verified\n")
})
