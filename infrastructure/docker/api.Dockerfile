# Identical native ARM64 Node/Debian ABI in build and runtime.
FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS build
WORKDIR /work
RUN npm install --global corepack@0.36.0 && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/database/package.json packages/database/tsconfig.json ./packages/database/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/
RUN corepack pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=4
COPY packages/contracts/src ./packages/contracts/src
COPY packages/database/src ./packages/database/src
COPY packages/database/drizzle ./packages/database/drizzle
COPY apps/api/src ./apps/api/src
RUN corepack pnpm --filter @cupmemo/contracts build \
    && corepack pnpm --filter @cupmemo/database build \
    && corepack pnpm --filter @cupmemo/api build
RUN corepack pnpm --filter @cupmemo/api deploy --legacy --prod --no-optional /out \
    && rm -rf /out/dist /out/node_modules/@cupmemo/contracts/dist /out/node_modules/@cupmemo/database/dist /out/node_modules/@cupmemo/database/drizzle \
    && cp -a apps/api/dist /out/dist \
    && cp -a packages/contracts/dist /out/node_modules/@cupmemo/contracts/dist \
    && cp -a packages/database/dist /out/node_modules/@cupmemo/database/dist \
    && cp -a packages/database/drizzle /out/node_modules/@cupmemo/database/drizzle \
    && rm -rf /out/src /out/tsconfig.json \
    && rm -rf /out/node_modules/@cupmemo/contracts/src /out/node_modules/@cupmemo/contracts/tsconfig.json /out/node_modules/@cupmemo/database/src /out/node_modules/@cupmemo/database/tsconfig.json

# Only the owner-approved, version-bound API test payload is removed from /out.
# This inline program is executed unchanged against disposable adversarial fixtures.
RUN node --input-type=module - /out /assembly-evidence <<'API_ASSEMBLY'
import assert from 'node:assert/strict';
import {lstatSync,readdirSync,readFileSync,readlinkSync,realpathSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,resolve,dirname,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
const [out,evidence]=process.argv.slice(2);
const approved=[
  ['@fastify+ajv-compiler@4.0.6','@fastify/ajv-compiler','test'],
  ['@fastify+error@4.2.0','@fastify/error','test'],
  ['@fastify+fast-json-stringify-compiler@5.1.0','@fastify/fast-json-stringify-compiler','test'],
  ['@fastify+merge-json-schemas@0.2.1','@fastify/merge-json-schemas','test'],
  ['@fastify+proxy-addr@5.1.1','@fastify/proxy-addr','test'],
  ['@pinojs+redact@0.4.0','@pinojs/redact','test'],
  ['avvio@9.3.0','avvio','test'],
  ['fast-json-stringify@6.4.0','fast-json-stringify','test'],
  ['fast-json-stringify@7.0.1','fast-json-stringify','test'],
  ['fast-uri@3.1.8','fast-uri','test'],
  ['fast-uri@4.2.1','fast-uri','test'],
  ['fastify@5.8.5','fastify','test'],
  ['fastq@1.20.3','fastq','test'],
  ['find-my-way@9.9.0','find-my-way','test'],
  ['json-schema-ref-resolver@3.0.0','json-schema-ref-resolver','test'],
  ['json-schema-traverse@1.0.0','json-schema-traverse','spec/fixtures'],
  ['light-my-request@6.6.0','light-my-request','test'],
  ['on-exit-leak-free@2.1.2','on-exit-leak-free','test'],
  ['pg-types@2.2.0','pg-types','test'],
  ['pino-abstract-transport@3.0.0','pino-abstract-transport','test'],
  ['pino-std-serializers@7.1.0','pino-std-serializers','test'],
  ['pino@10.4.0','pino','test'],
  ['process-warning@4.0.1','process-warning','test'],
  ['process-warning@5.1.0','process-warning','test'],
  ['quick-format-unescaped@4.0.4','quick-format-unescaped','test'],
  ['rfdc@1.4.1','rfdc','test'],
  ['safe-regex2@5.1.1','safe-regex2','test'],
  ['secure-json-parse@4.1.0','secure-json-parse','test'],
  ['sonic-boom@4.2.1','sonic-boom','fixtures'],
  ['sonic-boom@4.2.1','sonic-boom','test'],
  ['sonic-boom@4.2.1','sonic-boom','types/tests'],
  ['thread-stream@4.2.0','thread-stream','test'],
  ['zod@4.3.6','zod','src/v3/tests'],
  ['zod@4.3.6','zod','src/v4/classic/tests'],
  ['zod@4.3.6','zod','src/v4/core/tests'],
  ['zod@4.3.6','zod','src/v4/mini/tests'],
  ['zod@4.6.5','zod','src/v3/tests'],
  ['zod@4.6.5','zod','src/v4/classic/tests'],
  ['zod@4.6.5','zod','src/v4/core/tests'],
  ['zod@4.6.5','zod','src/v4/mini/tests'],
];
const roots=approved.map(([store,name,dir])=>`node_modules/.pnpm/${store}/node_modules/${name}/${dir}`).sort();
const excluded=p=>roots.some(root=>p===root||p.startsWith(root+'/'));
function confined(p) {
  const rel=relative(out,p);
  assert.ok(rel!==''&&!rel.startsWith('../')&&!isAbsolute(rel),'confinement: '+p);
  return rel;
}
function noSymlinkAncestors(p) {
  let current='/';
  for(const part of resolve(p).split('/').filter(Boolean)) {
    current=join(current,part);
    let st;
    try { st=lstatSync(current); } catch { assert.fail('preflight missing target: '+current); }
    assert.ok(!st.isSymbolicLink(),'preflight symlink ancestor: '+current);
  }
}
assert.ok(isAbsolute(out)&&out===resolve(out)&&out!=='/','confinement: assembly root');
assert.ok(isAbsolute(evidence)&&evidence===resolve(evidence)&&evidence!==out&&!evidence.startsWith(out+'/'),'confinement: evidence must be outside runtime');
noSymlinkAncestors(out);
noSymlinkAncestors(dirname(evidence));
// Refuse symlinked ancestry and any pre-existing output, even a dangling link.
if(readdirSync(dirname(evidence)).includes(evidence.split('/').at(-1))) {
  noSymlinkAncestors(evidence);
  assert.ok(lstatSync(evidence).isDirectory(),'preflight evidence must be a directory');
  assert.ok(!readdirSync(evidence).includes('assembly.json'),'preflight evidence output already exists');
}
assert.equal(roots.length,40);
assert.equal(new Set(roots).size,40);
for(const [store,name,dir] of approved) {
  const packageRoot=join(out,'node_modules/.pnpm',store,'node_modules',name);
  const target=join(packageRoot,dir);
  confined(target);
  assert.equal(target,resolve(packageRoot,dir),'confinement: target normalization');
  assert.ok(!dir.split('/').includes('..'),'confinement: traversal');
  noSymlinkAncestors(target);
  assert.ok(lstatSync(target).isDirectory(),'preflight target must be a directory: '+target);
  noSymlinkAncestors(join(packageRoot,'package.json'));
  const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
  assert.equal(manifest.name,name,'preflight package name drift');
  assert.equal(manifest.version,store.slice(store.lastIndexOf('@')+1),'preflight version drift');
}
function snapshot() {
  const result={};
  function walk(dir) {
    for(const name of readdirSync(dir).sort()) {
      const p=join(dir,name), rel=relative(out,p), st=lstatSync(p);
      if(excluded(rel)) continue;
      const meta={mode:st.mode,uid:st.uid,gid:st.gid};
      if(st.isDirectory()) { result[rel]={type:'directory',...meta}; walk(p); }
      else {
        assert.ok(st.isFile()||st.isSymbolicLink(),'unsupported retained file type: '+rel);
        result[rel]={...meta,size:st.size,mtime_ms:st.mtimeMs,ctime_ms:st.ctimeMs,ino:st.ino,nlink:st.nlink,
          ...(st.isSymbolicLink()?{link:readlinkSync(p)}:{sha256:createHash('sha256').update(readFileSync(p)).digest('hex')})};
      }
    }
  }
  walk(out); return result;
}
const before=snapshot();
const entries=[];
function retainedTarget(p,label) {
  assert.ok(!excluded(confined(p)),label+' target is approved for removal: '+p);
  let real;
  try { real=realpathSync(p); } catch { assert.fail(label+' target missing: '+p); }
  assert.ok(!excluded(confined(real)),label+' target resolves into removal: '+p);
}
for(const [rel,meta] of Object.entries(before)) {
  const p=join(out,rel);
  if(meta.link!==undefined) retainedTarget(p,'retained symlink');
  if(!rel.endsWith('package.json')||!meta.sha256) continue;
  const manifest=JSON.parse(readFileSync(p,'utf8'));
  if(!manifest.name||!manifest.version) continue;
  const require=createRequire(p);
  if(manifest.main) {
    const target=resolve(dirname(p),manifest.main);
    confined(target);
    let resolved;
    try { resolved=require.resolve(target); } catch { assert.fail('entry target missing: '+target); }
    retainedTarget(resolved,'entry');
    entries.push({package:rel,kind:'main',target:relative(out,resolved)});
  }
  // Resolve each subpath independently for Node's default import/require conditions.
  // Object insertion order is precedence; unknown conditions are dormant, not targets.
  function selectExport(value,conditions) {
    if(value===null||typeof value==='string') return value;
    if(Array.isArray(value)) {
      for(const target of value) {
        const selected=selectExport(target,conditions);
        if(selected!==undefined&&selected!==null) return selected;
      }
      return null;
    }
    if(value&&typeof value==='object') for(const [condition,target] of Object.entries(value)) {
      if(condition==='default'||conditions.has(condition)) {
        const selected=selectExport(target,conditions);
        if(selected!==undefined) return selected;
      }
    }
  }
  function validateExport(value) {
    if(value===null||value===undefined) return;
    if(typeof value==='string') {
      assert.ok(value.startsWith('./'),'export target must be package relative: '+p);
      const target=resolve(dirname(p),value);
      confined(target);
      if(value.includes('*')) {
        const pattern=relative(out,target).split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
        const matches=Object.keys(before).filter(key=>new RegExp('^'+pattern+'$').test(key));
        assert.ok(matches.length,'export wildcard target missing or removed: '+target);
        for(const match of matches) retainedTarget(join(out,match),'export');
        entries.push({package:rel,kind:'export-pattern',target:relative(out,target),matches:matches.length});
      } else {
        retainedTarget(target,'export');
        entries.push({package:rel,kind:'export',target:relative(out,target)});
      }
    }
  }
  const exportMap=manifest.exports;
  const subpaths=exportMap&&typeof exportMap==='object'&&!Array.isArray(exportMap)&&Object.keys(exportMap).some(key=>key.startsWith('.'))
    ?Object.values(exportMap):[exportMap];
  for(const mode of ['import','require']) {
    const conditions=new Set(['node','node-addons','module-sync',mode]);
    for(const target of subpaths) validateExport(selectExport(target,conditions));
  }
}
const removed=roots.map(path=>{
  let files=0,bytes=0,links=0;
  function count(p) {
    const st=lstatSync(p);
    if(st.isSymbolicLink()) links++;
    else if(st.isDirectory()) for(const name of readdirSync(p)) count(join(p,name));
    else { files++; bytes+=st.size; }
  }
  count(join(out,path)); return {path,files,bytes,links};
});
mkdirSync(evidence,{recursive:true});
const manifest={removed,entries,retained_before:before,retained_after:null,verified:false};
writeFileSync(join(evidence,'assembly.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({assembly:'preflight',roots:removed.length,files:removed.reduce((n,p)=>n+p.files,0),bytes:removed.reduce((n,p)=>n+p.bytes,0)}));
for(const root of roots) rmSync(join(out,root),{recursive:true});
const after=snapshot();
manifest.retained_after=after;
writeFileSync(join(evidence,'assembly.json'),JSON.stringify(manifest,null,2)+'\n');
assert.deepEqual(after,before,'retained payload changed');
for(const entry of entries) if(entry.kind!=='export-pattern') retainedTarget(join(out,entry.target),'runtime entry/export');
manifest.verified=true;
writeFileSync(join(evidence,'assembly.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({assembly:'verified',roots:removed.length,retained_entries:Object.keys(after).length}));
API_ASSEMBLY

# Export only hashes/metadata through BuildKit; never copy these into runtime.
FROM scratch AS assembly-evidence
COPY --from=build /assembly-evidence/ /

FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS runtime
ENV NODE_ENV=production CUPMEMO_API_HOST=0.0.0.0 CUPMEMO_API_PORT=4101
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 4101
CMD ["node", "dist/server.js"]
