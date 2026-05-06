# Multi-stage Docker build for AFL ETL Pipeline
# Stage 1: R Environment
FROM r-base:4.3.0 AS r-stage

# Install R packages dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libcurl4-openssl-dev \
        libssl-dev \
        libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install R packages
RUN R -e "install.packages(c('remotes', 'jsonlite', 'janitor', 'dplyr', 'stringr'), repos='https://cran.rstudio.com/')" \
    && R -e "remotes::install_version('fitzRoy', version='1.6.0', repos='https://cran.rstudio.com/', upgrade='never')"

# Stage 2: Node.js Environment
FROM node:22-bookworm-slim AS node-stage

# Install dependencies including dev dependencies for build
WORKDIR /app
COPY etl/package*.json ./etl/
RUN npm --prefix etl ci

# Copy source files
COPY etl ./etl
COPY shared ./shared
COPY src/lib/stats ./src/lib/stats

# Build TypeScript
RUN npm --prefix etl run build

# Clean up dev dependencies
RUN npm --prefix etl prune --omit=dev

# Stage 3: Production Image
FROM r-stage AS runtime

# Copy the Node.js runtime from the official LTS image.
COPY --from=node-stage /usr/local/bin/node /usr/local/bin/node

# Set working directory
WORKDIR /etl

# Copy built artifacts
COPY --from=node-stage /app/etl/node_modules ./node_modules
COPY --from=node-stage /app/etl/dist ./dist
COPY --from=node-stage /app/etl/*.R ./

# Copy package.json for runtime
COPY --from=node-stage /app/etl/package.json ./

# Environment variables
ENV NODE_ENV=production
ENV SEASON=""
ENV ROUND=""

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "console.log('Health check passed')"

# Default command runs the live guard
CMD ["node", "dist/etl/liveGuard.js"]
