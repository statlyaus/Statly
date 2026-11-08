# Live ETL runtime: node dist/liveGuard.js spawns `Rscript fetch_fw_round.R` and pipes its NDJSON
# into dist/processFootywireData.js. R uses the same pinned base and CRAN snapshot as the trade
# capture image (afl-trade-intelligence/Dockerfile). CI builds this image on every change.

FROM node:22-bookworm-slim AS node-build
WORKDIR /etl
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY *.ts ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS node-runtime

FROM rocker/r-ver:4.5.1@sha256:03b023fbf7b1b24ac1bb8b2ac5fd7e15a767e67b40ff50c155e328110981c2aa

ARG R_REPOSITORY=https://packagemanager.posit.co/cran/__linux__/noble/2026-08-07
ARG FITZROY_VERSION=1.7.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    NODE_ENV=production

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# The base image is pinned by digest; exact apt versions would break the build when Ubuntu
# retires them from its archive.
# skipcq: DOK-DL3008
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      libcurl4-openssl-dev \
      libicu-dev \
      libssl-dev \
      libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

# Every package fetch_fw_round.R and fetch_fw_positions.R load; the build fails if one is missing.
RUN Rscript --vanilla -e "repos <- '${R_REPOSITORY}'; \
  install.packages(c('remotes', 'jsonlite', 'janitor', 'dplyr', 'stringr', 'data.table'), repos = repos); \
  remotes::install_version('fitzRoy', version = '${FITZROY_VERSION}', repos = repos, upgrade = 'never'); \
  stopifnot(as.character(packageVersion('fitzRoy')) == '${FITZROY_VERSION}'); \
  for (p in c('fitzRoy', 'jsonlite', 'janitor', 'dplyr', 'stringr', 'data.table')) \
    stopifnot(requireNamespace(p, quietly = TRUE))"

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

WORKDIR /etl
COPY --from=node-build /etl/node_modules ./node_modules
COPY --from=node-build /etl/dist ./dist
COPY package.json ./
COPY *.R ./

RUN node --version \
    && useradd --create-home --shell /usr/sbin/nologin --uid 10001 statly-etl

USER 10001:10001

CMD ["node", "dist/liveGuard.js"]
