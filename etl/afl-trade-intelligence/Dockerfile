FROM rocker/r-ver:4.5.1@sha256:03b023fbf7b1b24ac1bb8b2ac5fd7e15a767e67b40ff50c155e328110981c2aa

ARG R_REPOSITORY=https://packagemanager.posit.co/cran/2026-08-07
ARG RENV_VERSION=1.2.4
ARG R_LOCK_SHA256=061c2ff232be7bd262ae64b29100a773d437748471fb96936f2c768d0ab9c24a

LABEL org.opencontainers.image.title="Statly AFL trade-intelligence fitzRoy capture" \
      org.opencontainers.image.description="Sealed direct-function fitzRoy evidence capture runtime" \
      au.com.statly.fitzroy.version="1.7.0" \
      au.com.statly.r.version="4.5.1" \
      au.com.statly.renv.lock.sha256="${R_LOCK_SHA256}"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    RENV_CONFIG_REPOS_OVERRIDE=${R_REPOSITORY} \
    RENV_CONFIG_CACHE_ENABLED=FALSE \
    RENV_PATHS_LIBRARY=/opt/statly/renv/library \
    STATLY_CAPTURE_RENV_PROJECT=/opt/statly/capture \
    STATLY_R_LOCK_SHA256=${R_LOCK_SHA256}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      libcurl4-openssl-dev \
      libicu-dev \
      libssl-dev \
      libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/statly/capture
COPY renv.lock ./renv.lock

RUN Rscript --vanilla -e "install.packages('renv', repos = Sys.getenv('RENV_CONFIG_REPOS_OVERRIDE')); stopifnot(as.character(packageVersion('renv')) == '${RENV_VERSION}'); renv::restore(lockfile = 'renv.lock', project = '.', prompt = FALSE); stopifnot(as.character(packageVersion('fitzRoy')) == '1.7.0', as.character(packageVersion('digest')) == '0.6.39')" \
    && printf '%s  %s\n' "${R_LOCK_SHA256}" renv.lock | sha256sum --check --strict

COPY capture_fitzroy.R decode_fitzroy_capture.R test_decode_contract.R ./

RUN chmod 0555 capture_fitzroy.R decode_fitzroy_capture.R test_decode_contract.R \
    && useradd --create-home --shell /usr/sbin/nologin --uid 10001 statly-capture \
    && chown --recursive root:root /opt/statly \
    && chmod --recursive go-w /opt/statly

USER 10001:10001

# The orchestrator must start this image by immutable digest, inject that same digest through
# STATLY_CAPTURE_IMAGE_DIGEST, mount only the invocation/output directory, and use --read-only with a
# bounded tmpfs. The script rejects ordinary captures when the digest is absent.
ENTRYPOINT ["Rscript", "--vanilla", "/opt/statly/capture/capture_fitzroy.R"]
