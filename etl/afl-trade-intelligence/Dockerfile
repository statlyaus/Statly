FROM rocker/r-ver:4.5.1@sha256:03b023fbf7b1b24ac1bb8b2ac5fd7e15a767e67b40ff50c155e328110981c2aa

ARG R_REPOSITORY=https://packagemanager.posit.co/cran/2026-08-07
ARG RENV_VERSION=1.2.4
ARG R_LOCK_SHA256=061c2ff232be7bd262ae64b29100a773d437748471fb96936f2c768d0ab9c24a
ARG FITZROY_SOURCE_SHA256=296ef05e86cb3ed8473f88948a1561a05ee3db0b5e037624f2dba0acf20b5412
ARG FITZROY_AFLCA_PATCH_SHA256=bbcb2445453ae1787da56c81a0576f1d1db4ccd21f946d2993a3380c10f1ad06

LABEL org.opencontainers.image.title="Statly AFL trade-intelligence fitzRoy capture" \
      org.opencontainers.image.description="Sealed direct-function fitzRoy evidence capture runtime" \
      au.com.statly.fitzroy.version="1.7.0" \
      au.com.statly.fitzroy.source.sha256="${FITZROY_SOURCE_SHA256}" \
      au.com.statly.fitzroy.aflca.patch.sha256="${FITZROY_AFLCA_PATCH_SHA256}" \
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
      ca-certificates \
      curl \
      patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/statly/capture
COPY renv.lock ./renv.lock
COPY patches/fitzRoy-1.7.0-scoped-aflca-votes.patch ./patches/fitzRoy-1.7.0-scoped-aflca-votes.patch

RUN Rscript --vanilla -e "install.packages('renv', repos = Sys.getenv('RENV_CONFIG_REPOS_OVERRIDE')); stopifnot(as.character(packageVersion('renv')) == '${RENV_VERSION}'); renv::restore(lockfile = 'renv.lock', project = '.', prompt = FALSE); stopifnot(as.character(packageVersion('fitzRoy')) == '1.7.0', as.character(packageVersion('digest')) == '0.6.39')" \
    && printf '%s  %s\n' "${R_LOCK_SHA256}" renv.lock | sha256sum --check --strict \
    && printf '%s  %s\n' "${FITZROY_AFLCA_PATCH_SHA256}" patches/fitzRoy-1.7.0-scoped-aflca-votes.patch | sha256sum --check --strict \
    && curl --fail --silent --show-error --location \
      https://cran.r-project.org/src/contrib/Archive/fitzRoy/fitzRoy_1.7.0.tar.gz \
      --output /tmp/fitzRoy_1.7.0.tar.gz \
    && printf '%s  %s\n' "${FITZROY_SOURCE_SHA256}" /tmp/fitzRoy_1.7.0.tar.gz | sha256sum --check --strict \
    && mkdir /tmp/fitzRoy-source \
    && tar --extract --gzip --file /tmp/fitzRoy_1.7.0.tar.gz --directory /tmp/fitzRoy-source \
    && patch --batch --forward --strip=1 --directory /tmp/fitzRoy-source/fitzRoy \
      < patches/fitzRoy-1.7.0-scoped-aflca-votes.patch \
    && Rscript --vanilla -e "target_library <- dirname(find.package('fitzRoy')); install.packages('/tmp/fitzRoy-source/fitzRoy', repos = NULL, type = 'source', lib = target_library); stopifnot(as.character(packageVersion('fitzRoy')) == '1.7.0', 'award_scope' %in% names(formals(fitzRoy::fetch_coaches_votes)))"

COPY capture_fitzroy.R decode_fitzroy_capture.R test_decode_contract.R test_coaches_votes_scope_contract.R ./

RUN Rscript --vanilla test_coaches_votes_scope_contract.R \
    && chmod 0555 capture_fitzroy.R decode_fitzroy_capture.R test_decode_contract.R test_coaches_votes_scope_contract.R \
    && useradd --create-home --shell /usr/sbin/nologin --uid 10001 statly-capture \
    && chown --recursive root:root /opt/statly \
    && chmod --recursive go-w /opt/statly

USER 10001:10001

# The orchestrator must start this image by immutable digest, inject that same digest through
# STATLY_CAPTURE_IMAGE_DIGEST, mount only the invocation/output directory, and use --read-only with a
# bounded tmpfs. The script rejects ordinary captures when the digest is absent.
ENTRYPOINT ["Rscript", "--vanilla", "/opt/statly/capture/capture_fitzroy.R"]
