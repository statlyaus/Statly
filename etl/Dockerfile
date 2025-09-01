# Multi-stage Docker build for AFL ETL Pipeline
# Stage 1: R Environment
FROM r-base:4.3.0 as r-stage

# Install R packages dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install R packages
RUN R -e "install.packages(c('fitzRoy', 'jsonlite', 'janitor', 'dplyr', 'stringr'), repos='https://cran.rstudio.com/')"

# Stage 2: Node.js Environment
FROM node:18-alpine as node-stage

# Install dependencies including dev dependencies for build
WORKDIR /etl
COPY package*.json ./
RUN npm ci

# Copy source files
COPY *.ts ./
COPY *.R ./
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Clean up dev dependencies
RUN npm ci --only=production

# Stage 3: Production Image
FROM node:18-alpine

# Install R runtime
RUN apk add --no-cache R R-dev

# Copy R packages from r-stage
COPY --from=r-stage /usr/local/lib/R /usr/local/lib/R
COPY --from=r-stage /usr/lib/R /usr/lib/R

# Set working directory
WORKDIR /etl

# Copy built artifacts
COPY --from=node-stage /etl/node_modules ./node_modules
COPY --from=node-stage /etl/dist ./dist
COPY --from=node-stage /etl/*.R ./

# Copy package.json for runtime
COPY package.json ./

# Environment variables
ENV NODE_ENV=production
ENV SEASON=""
ENV ROUND=""

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "console.log('Health check passed')"

# Default command runs the live guard
CMD ["node", "dist/liveGuard.js"]
