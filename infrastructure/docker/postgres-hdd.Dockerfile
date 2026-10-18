# Verified official PG17 Debian ARM64 manifest, not a mutable runtime selection.
# docker-library/postgres 2603e26e245e558218728ee14e0a42dcb020dc7f:17/bookworm
FROM postgres:17.11-bookworm@sha256:a85953d6f830fd55a12929df3b7a4fa94dc96d652de62d2d714e0867ccb3670d AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY postgres-hdd-entrypoint.c /build/postgres-hdd-entrypoint.c
RUN cc -std=c17 -O2 -Wall -Wextra -Werror -Wformat=2 -Wconversion -Wshadow \
    -D_FORTIFY_SOURCE=3 -fstack-protector-strong -fPIE -pie -Wl,-z,relro,-z,now \
    /build/postgres-hdd-entrypoint.c -o /build/cupmemo-postgres-hdd \
    && strip /build/cupmemo-postgres-hdd

FROM postgres:17.11-bookworm@sha256:a85953d6f830fd55a12929df3b7a4fa94dc96d652de62d2d714e0867ccb3670d AS runtime
# Nonrecursive IMAGE-only metadata correction; never touch mounted data at runtime.
RUN chown root:root /var/lib/postgresql && chmod 0755 /var/lib/postgresql
COPY --from=build --chmod=0555 /build/cupmemo-postgres-hdd /usr/local/bin/cupmemo-postgres-hdd
ENTRYPOINT ["/usr/local/bin/cupmemo-postgres-hdd"]
CMD ["postgres"]
