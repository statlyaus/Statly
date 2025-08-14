# ETL Pipeline Dockerfile
FROM rocker/r-ver:4.3.0

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Install R packages
RUN R -e 'install.packages(c("fitzRoy", "jsonlite", "janitor", "dplyr", "stringr"), repos="https://cran.rstudio.com/")'

# Set working directory
WORKDIR /app

# Copy ETL files
COPY package.json tsconfig.json ./
COPY *.ts *.R ./

# Install Node dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Make R script executable
RUN chmod +x fetch_fw_round.R

# Set environment variables
ENV NODE_ENV=production

# Run the ingestor
CMD ["npm", "start"]
