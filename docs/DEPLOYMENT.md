# CupMemo Deployment

## Initial production host

CupMemo initially runs on a Raspberry Pi 5 home server.

Existing environment:
- Raspberry Pi 5
- SSD
- external HDD
- Hermes already running on the Pi
- developer PC connects via Tailscale + SSH

Do not disrupt Hermes or unrelated services.

## Storage

### SSD

Use the SSD for:
- GitHub repository checkout
- source code
- node_modules/build context
- application build output
- normal development/application files
- optionally a backup copy of DB dumps when appropriate

### External HDD

Use the external HDD for:
- production PostgreSQL data

Do not place PostgreSQL's live data directory inside the Git repository.

Do not assume the HDD mount path. Discover it on the actual Pi.

## Production services

Target Docker Compose services:

```text
cupmemo-web
cupmemo-api
cupmemo-postgres
cloudflared
```

Use:
- private Docker networking
- health checks
- sensible restart policies
- externalized environment configuration
- persistent database storage
- structured logs

Do not expose unnecessary ports.

## Intended network path

```text
Internet
   |
HTTPS
   v
Cloudflare
   |
Cloudflare Tunnel
   |
Raspberry Pi 5
   |
   +--> Next.js
   |
   +--> Fastify API
          |
          v
       PostgreSQL (HDD)
```

Private administration:

```text
Developer PC --> Tailscale --> SSH --> Raspberry Pi
```

CupMemo users do not need Tailscale.

## Same-origin routing

Prefer one public application hostname.

Conceptually:

```text
https://cupmemo.example/
https://cupmemo.example/api/v1/...
```

The public routing/proxy layer should send:
- normal app traffic to Next.js
- `/api/v1/*` to Fastify

Fastify remains a separate service even when routed under the same origin.

PostgreSQL remains private.

## Cloudflare Tunnel

Cloudflare Tunnel is **not preinstalled or preconfigured**.

Setting it up is part of the deployment work.

Prefer running `cloudflared` in the production Compose stack unless a strong technical reason suggests otherwise.

Use current official Cloudflare documentation during implementation rather than relying on old commands.

Goals:
- public HTTPS
- no home-router port forwarding
- no public SSH
- no public PostgreSQL
- no unnecessary direct Fastify exposure

Tunnel credentials/tokens are secrets.

Never:
- commit them
- put real values in documentation
- print them unnecessarily in logs

Use environment/secrets configuration and appropriate `.gitignore` rules.

If Cloudflare requires an interactive account/domain authorization step, automate everything else possible and document the exact manual step.

## Environment variables

Expected examples:

```text
NODE_ENV
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
POSTGRES_DATA_DIR
UPLOAD_DATA_DIR
BACKUP_DIR
CLOUDFLARE_TUNNEL_TOKEN
```

Names may evolve, but environment-specific filesystem paths and secrets must not be hard-coded in application source.

Commit only example files such as `.env.example`, never production values.

## Pre-deployment Pi audit

Before assigning ports or writing production paths:

1. inspect OS/architecture
2. inspect Docker/Compose availability
3. inspect SSD/HDD mounts
4. inspect free space
5. inspect running containers/services
6. inspect occupied ports
7. verify Tailscale connectivity

Do not stop unrelated services merely to obtain a preferred port.

## HDD startup guard

Before PostgreSQL starts:
- verify the expected external HDD mount is present
- verify the configured DB data directory resolves onto that mounted filesystem

If not, fail startup.

This is required to avoid Docker creating a normal directory on the root/SSD filesystem when the HDD is absent.

## Backups

Implement automated PostgreSQL dumps.

Initial retention:
- 7 daily
- 4 weekly
- 3 monthly

Where practical, keep at least one backup copy on storage separate from the live database, such as the SSD.

Document:
- backup command/job
- backup location
- retention
- restore procedure
- verification procedure

Perform an actual safe restoration test before considering backup/recovery complete.

## Reboot/recovery expectations

A normal Pi reboot should result in:
1. required storage mounts available
2. HDD guard passes
3. PostgreSQL starts
4. API becomes ready
5. web app starts
6. cloudflared reconnects
7. public HTTPS becomes healthy

If the HDD is absent, PostgreSQL should remain stopped and the failure should be obvious in logs.

## Future migration

The deployment should not assume the Pi forever.

Possible future moves:
- Next.js -> Vercel/Cloudflare/AWS
- Fastify -> ECS/EC2/Fly/Render/etc.
- PostgreSQL -> RDS/managed PostgreSQL
- uploads -> S3/R2

Do not build those cloud resources during MVP.
