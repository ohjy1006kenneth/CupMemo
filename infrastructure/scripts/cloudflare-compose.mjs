import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const { structuredClone } = globalThis;

const checkout = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const repository = checkout.split('/.worktrees/')[0];
const keys = [
  'CUPMEMO_CLOUDFLARED_IMAGE',
  'CUPMEMO_CLOUDFLARED_UID',
  'CLOUDFLARE_TUNNEL_TOKEN_FILE',
];

// Pure offline shape validation only. No file reads, environment loading or launch CLI.
// Digest spelling does not prove provenance/version/ARM64 or local image availability.
export function verifyCloudflareInputs(inputs) {
  const refuse = () => {
    throw new Error('Cloudflare inputs refused');
  };
  if (
    !inputs ||
    Object.keys(inputs).length !== keys.length ||
    keys.some(
      (key) => typeof inputs[key] !== 'string' || !inputs[key] || /\p{Cc}/u.test(inputs[key]),
    )
  )
    refuse();
  const {
    CUPMEMO_CLOUDFLARED_IMAGE: image,
    CUPMEMO_CLOUDFLARED_UID: uid,
    CLOUDFLARE_TUNNEL_TOKEN_FILE: file,
  } = inputs;
  if (!/^(?:docker\.io\/)?cloudflare\/cloudflared@sha256:[a-f0-9]{64}$/.test(image)) refuse();
  if (!/^[1-9][0-9]{0,9}$/.test(uid) || Number(uid) > 2147483647) refuse();
  if (
    !path.isAbsolute(file) ||
    file === '/' ||
    path.normalize(file) !== file ||
    file.endsWith('/') ||
    file === repository ||
    file.startsWith(`${repository}/`)
  )
    refuse();
  return Object.fromEntries(keys.map((key) => [key, inputs[key]]));
}

// Compare an actual offline render with the unchanged base render. Only the
// three explicitly allowed additions may differ. Never log either model.
export function verifyCloudflareModel(base, merged, inputs) {
  const settings = verifyCloudflareInputs(inputs);
  const service = structuredClone(merged.services?.cloudflared);
  const network = structuredClone(merged.networks?.['tunnel-egress']);
  const secret = merged.secrets?.cloudflare_tunnel_token;
  const refuse = () => {
    throw new Error('Cloudflare model refused');
  };
  if (!service || !network || !secret) refuse();
  for (const key of ['cpus', 'mem_limit', 'memswap_limit']) service[key] = Number(service[key]);
  // Compose serializes default entrypoint as absent or null, and empty IPAM
  // as absent or {}. No other unknown/unsafe fields are silently stripped.
  if (service.entrypoint === null) delete service.entrypoint;
  if (isDeepStrictEqual(network.ipam, {})) delete network.ipam;
  if (network.internal === false) delete network.internal;
  if (network.external === false) delete network.external;
  const expected = {
    profiles: ['tunnel'],
    image: settings.CUPMEMO_CLOUDFLARED_IMAGE,
    platform: 'linux/arm64',
    pull_policy: 'never',
    restart: 'no',
    user: `${settings.CUPMEMO_CLOUDFLARED_UID}:${settings.CUPMEMO_CLOUDFLARED_UID}`,
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    cpus: 0.25,
    mem_limit: 67108864,
    memswap_limit: 67108864,
    pids_limit: 64,
    logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
    command: ['tunnel', 'run'],
    environment: { TUNNEL_TOKEN_FILE: '/run/secrets/cloudflare_tunnel_token' },
    secrets: [
      { source: 'cloudflare_tunnel_token', target: '/run/secrets/cloudflare_tunnel_token' },
    ],
    networks: { frontend: null, 'tunnel-egress': null },
  };
  if (
    !isDeepStrictEqual(service, expected) ||
    !isDeepStrictEqual(network, { name: `${base.name}_tunnel-egress` }) ||
    !isDeepStrictEqual(secret, {
      name: `${base.name}_cloudflare_tunnel_token`,
      file: settings.CLOUDFLARE_TUNNEL_TOKEN_FILE,
    })
  )
    refuse();
  const remainder = structuredClone(merged);
  delete remainder.services.cloudflared;
  delete remainder.networks['tunnel-egress'];
  delete remainder.secrets.cloudflare_tunnel_token;
  if (!isDeepStrictEqual(base, remainder)) refuse();
}
