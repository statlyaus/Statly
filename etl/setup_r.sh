#!/bin/bash

# Install R packages required for fitzRoy data fetching
echo "Installing R packages for fitzRoy ETL pipeline..."

R -e 'install.packages(c("fitzRoy", "jsonlite", "janitor", "dplyr", "stringr"), repos="https://cran.rstudio.com/")'

echo "R packages installed successfully!"
echo ""
echo "To test the R script manually:"
echo "  Rscript etl/fetch_fw_round.R 2025 18 | head"
echo ""
echo "To run the full pipeline (requires FIREBASE_SERVICE_ACCOUNT_JSON_BASE64):"
echo "  cd etl && npm install && npm run dev"
