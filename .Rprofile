# Disable all R linting and diagnostics
# This prevents VS Code chat interface linter errors

options(
  lintr.linter_file = NULL,
  repos = c(CRAN = "https://cran.rstudio.com/")
)

# Suppress startup messages
suppressPackageStartupMessages <- function(expr) {
  suppressMessages(suppressWarnings(expr))
}
