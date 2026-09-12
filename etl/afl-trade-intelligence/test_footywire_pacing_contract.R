#!/usr/bin/env Rscript

# Offline contract at the public season-fetch boundary. Only HTTP responses are replaced.
local({
  stopifnot(as.character(utils::packageVersion("fitzRoy")) == "1.7.0")
  curl_namespace <- asNamespace("curl")
  xml_namespace <- asNamespace("xml2")
  original_fetch <- get("curl_fetch_memory", curl_namespace)
  original_handle <- get("new_handle", curl_namespace)
  original_read <- get("read_html", xml_namespace)
  utils_namespace <- asNamespace("utils")
  original_download <- get("download.file", utils_namespace)
  replace_binding <- function(namespace, name, value) {
    unlockBinding(name, namespace)
    assign(name, value, envir = namespace)
    lockBinding(name, namespace)
  }
  on.exit({
    replace_binding(curl_namespace, "curl_fetch_memory", original_fetch)
    replace_binding(curl_namespace, "new_handle", original_handle)
    replace_binding(xml_namespace, "read_html", original_read)
    replace_binding(utils_namespace, "download.file", original_download)
  }, add = TRUE)

  starts <- numeric()
  completions <- numeric()
  urls <- character()
  scenario <- "success"
  table_html <- function(player, advanced) {
    link <- if (startsWith(player, "H")) "pp-home--player" else "pp-away--player"
    player <- paste0("<a href='", link, "'>", player, "</a>")
    if (advanced) {
      paste0("<table><tr><th>Player</th><th>GA</th><th>DE%</th><th>TOG%</th><th>1%</th></tr>",
             "<tr><td>", player, "</td><td>1</td><td>75</td><td>80</td><td>2</td></tr></table>")
    } else {
      paste0("<table><tr><th>Player</th><th>GA</th><th>G</th></tr>",
             "<tr><td>", player, "</td><td>1</td><td>3</td></tr></table>")
    }
  }
  match_html <- function(advanced) {
    empty <- "<table><tr><td>unused</td></tr></table>"
    paste0(
      "<html><body><div class='notice'>Advanced statistics</div>",
      "<table class='lnormtop'><tr><td>Match</td></tr>",
      "<tr><td class='lnorm'>Round 1, Test Oval</td></tr>",
      "<tr><td class='lnorm'>Saturday, 1 March 2025, 1 PM</td></tr></table>",
      "<table id='matchscoretable'><tr><td>Team</td></tr>",
      "<tr><td><a>Home Club</a></td></tr><tr><td><a>Away Club</a></td></tr></table>",
      paste(rep(empty, 10L), collapse = ""),
      table_html(if (advanced) "H Player" else "Home Player", advanced),
      paste(rep(empty, 4L), collapse = ""),
      table_html(if (advanced) "A Player" else "Away Player", advanced),
      "</body></html>"
    )
  }
  list_html <- paste0(
    "<html><table><tr><td></td><td></td><td></td><td></td><td class='data'>",
    "<a href='ft_match_statistics?mid=1'>One</a>",
    "<a href='ft_match_statistics?mid=2'>Two</a></td></tr></table></html>"
  )
  response <- function(url) {
    starts <<- c(starts, unname(proc.time()[["elapsed"]]))
    urls <<- c(urls, url)
    on.exit(completions <<- c(completions, unname(proc.time()[["elapsed"]])), add = TRUE)
    Sys.sleep(0.12) # Distinguish completion-relative pacing from start-relative pacing.
    if (scenario == "transport_failure") stop("Synthetic transport failure")
    if (scenario %in% c("redirect", "same_origin_redirect", "http_failure")) {
      location <- if (scenario == "same_origin_redirect") {
        "https://www.footywire.com/afl/footy/ft_match_list?year=2025"
      } else "https://unexpected.example/redirect"
      return(list(status_code = if (scenario == "http_failure") 503L else 302L,
                  headers = charToRaw(paste0("HTTP/1.1 302 Found\r\nLocation: ", location, "\r\n\r\n")),
                  content = raw()))
    }
    body <- if (grepl("ft_match_list", url, fixed = TRUE)) list_html else {
      match_html(grepl("advv=Y", url, fixed = TRUE))
    }
    list(status_code = 200L, headers = charToRaw("HTTP/1.1 200 OK\r\n\r\n"),
         content = charToRaw(body))
  }
  replace_binding(curl_namespace, "curl_fetch_memory", function(url, handle, ...) {
    response(url)
  })
  replace_binding(curl_namespace, "new_handle", function(...) {
    options <- list(...)
    stopifnot(identical(options$followlocation, FALSE))
    stopifnot(options$connecttimeout > 0, options$timeout > 0)
    original_handle(...)
  })
  # Accommodates the unpatched network boundary for the RED run, without making network calls.
  replace_binding(xml_namespace, "read_html", function(x, ...) {
    if (is.character(x) && length(x) == 1L && grepl("^https?://", x)) {
      x <- response(x)$content
    }
    original_read(x, ...)
  })

  result <- suppressMessages(fitzRoy::fetch_player_stats_footywire(
    season = 2025, check_existing = FALSE
  ))
  expected <- data.frame(
    Date = rep(as.Date("2025-03-01"), 4L), Season = rep(2025, 4L),
    Round = rep("Round 1", 4L), Venue = rep("Test Oval", 4L),
    Player = rep(c("Home Player", "Away Player"), 2L),
    Team = rep(c("Home Club", "Away Club"), 2L),
    Opposition = rep(c("Away Club", "Home Club"), 2L),
    Status = rep(c("Home", "Away"), 2L), Match_id = c(1, 1, 2, 2),
    GA = rep(1, 4L), PlayerLink = rep(c("pp-home--player", "pp-away--player"), 2L),
    DE = rep(75, 4L), TOG = rep(80, 4L),
    One.Percenters = rep(2, 4L), G = rep(3, 4L)
  )
  stopifnot(identical(as.data.frame(result), expected))
  stopifnot(length(starts) == 5L)
  if (any(diff(starts) < 3)) stop("FootyWire requests started less than three seconds apart.")
  stopifnot(all(starts[-1L] - head(completions, -1L) >= 3))
  stopifnot(all(grepl("^https://www[.]footywire[.]com/", urls)))
  cat("FootyWire consecutive-match pacing and unchanged-output contract verified\n")

  for (failure in c("redirect", "same_origin_redirect", "transport_failure", "http_failure")) {
    scenario <- failure
    before <- length(starts)
    failed <- try(suppressMessages(fitzRoy::fetch_player_stats_footywire(
      season = 2025, check_existing = FALSE
    )), silent = TRUE)
    stopifnot(inherits(failed, "try-error"), length(starts) == before + 1L)
    stopifnot(tail(diff(starts), 1L) >= 3)
    stopifnot(tail(starts, 1L) - completions[[before]] >= 3)
    stopifnot(!any(grepl("unexpected.example", urls, fixed = TRUE)))
  }
  cat("FootyWire redirects, HTTP errors and subsequent-call pacing verified\n")

  scenario <- "success"
  downloads <- 0L
  cache <- data.frame(Season = c(2025L, 2025L), Match_id = c(1, 2),
                      Player = c("Cached Player One", "Cached Player Two"), G = c(0, 4))
  replace_binding(utils_namespace, "download.file", function(url, destfile, ...) {
    stopifnot(identical(url, "https://github.com/jimmyday12/fitzroy_data/raw/main/data-raw/player_stats/player_stats.rda"))
    downloads <<- downloads + 1L
    save(cache, file = destfile)
    0L
  })
  before <- length(starts)
  cached <- suppressMessages(fitzRoy::fetch_player_stats_footywire(
    season = 2025, check_existing = TRUE
  ))
  stopifnot(identical(as.data.frame(cached), cache), downloads == 1L)
  stopifnot(length(starts) == before + 1L, tail(diff(starts), 1L) >= 3)
  stopifnot(tail(starts, 1L) - completions[[before]] >= 3)
  cat("FootyWire cached-return behavior preserved\n")
})
