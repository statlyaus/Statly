#!/bin/bash

# Install R packages required for fitzRoy data fetching
echo "Installing R packages for fitzRoy ETL pipeline..."

R -e 'install.packages(c("fitzRoy", "jsonlite", "janitor", "dplyr", "stringr"), repos="https://cran.rstudio.com/")'

echo "R packages installed successfully!"
echo ""
echo "To test the R script manually:"
echo "  Rscript etl/fetch_fw_round.R 2025 18 /tmp/test_output.json"
echo ""
echo "To run the full ingestor (requires GOOGLE_SERVICE_ACCOUNT env var):"
echo "  cd etl && npm install && npm run dev"
