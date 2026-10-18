"""Run ONLY on disposable GitHub-hosted ARM64; never a Pi build helper.

Each heavy command is fenced by requested AND effective cgroup limits. The
source-only patch fixture is not a manager. This downloads the full pinned public
manager, generates real APIs, compiles it and runs only the named service tests.
"""
import gzip
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

import time
from urllib.parse import urlparse

from materialize import checked, extract_regular, identity, materialize

BUNDLE = Path(__file__).resolve().parent
LOCK = json.loads((BUNDLE / "source-lock.json").read_text())
EVIDENCE = Path(os.environ["EVIDENCE"])
WORK = Path(os.environ["RUNNER_TEMP"]) / ("appmanagement-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"])
PREFIX = WORK.name
OWNED = []
SEQUENCE = 0
ENV = {"PATH": "/work/go/bin:/usr/local/bin:/usr/bin:/bin", "HOME": "/work/home", "TMPDIR": "/work/tmp", "LANG": "C.UTF-8", "GOTOOLCHAIN": "local", "GOPROXY": "https://proxy.golang.org", "GOSUMDB": "sum.golang.org", "GOPRIVATE": "", "GONOSUMDB": "", "CGO_ENABLED": "0", "GOOS": "linux", "GOARCH": "arm64", "GOMAXPROCS": "2", "GOMEMLIMIT": "1GiB", "GOFLAGS": "-p=1", "GOCACHE": "/work/cache", "GOMODCACHE": "/work/modules", "GOBIN": "/work/bin"}


def record(name, value):
    (EVIDENCE / (name + ".json")).write_text(json.dumps(value, indent=2) + "\n")


def run(args, timeout=120, expected=0):
    global SEQUENCE
    SEQUENCE += 1
    stem = f"{SEQUENCE:03d}"
    started = time.monotonic()
    with (EVIDENCE / (stem + ".log")).open("w") as output:
        try:
            result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT, text=True, timeout=timeout)
            code = result.returncode
        except subprocess.TimeoutExpired:
            code = 124
    text = (EVIDENCE / (stem + ".log")).read_text()
    record(stem, {"argv": args, "exit": code, "elapsed_seconds": time.monotonic() - started})
    print(stem, args, "exit", code, flush=True)
    if code != expected:
        print(text[-20000:], flush=True)
        raise RuntimeError(f"command {stem} failed: {code}")
    return text.strip()


def download(key, filename, hosts, maximum):
    spec = LOCK[key]
    effective = run(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "180", "--max-filesize", str(maximum), "--output", str(filename), "--write-out", "%{url_effective}", spec["url"]], timeout=190)
    assert urlparse(effective).scheme == "https" and urlparse(effective).hostname in hosts
    checked(filename, spec)
    record(key + "-download", {"effective_url": effective, **identity(filename)})


def inspect(name):
    data = json.loads(run(["docker", "inspect", name]))[0]
    record(name + "-inspect", data)
    return data


def fence(name, network):
    data = inspect(name)
    host = data["HostConfig"]
    assert host["Memory"] == host["MemorySwap"] == 3221225472
    assert host["NanoCpus"] == 2000000000 and host["PidsLimit"] == 256
    assert not host["Privileged"] and host["CapDrop"] == ["ALL"] and not host["CapAdd"]
    assert any(p in ("no-new-privileges", "no-new-privileges:true") for p in host["SecurityOpt"])
    assert host["NetworkMode"] == network and not host["PortBindings"] and not host["Devices"]
    assert len(data["Mounts"]) == 1 and data["Mounts"][0]["Source"] == str(WORK) and data["Mounts"][0]["Destination"] == "/work"
    assert not data["Config"]["Volumes"] and data["Config"]["Labels"]["cupmemo.issue11"] == PREFIX
    effective = run(["docker", "exec", name, "/usr/local/bin/node", "-e", "const f=require('fs');const v={};for(const k of ['memory.max','memory.swap.max','cpu.max','pids.max'])v[k]=f.readFileSync('/sys/fs/cgroup/'+k,'utf8').trim();console.log(JSON.stringify(v))"])
    limits = json.loads(effective)
    assert limits["memory.max"] == "3221225472" and limits["memory.swap.max"] == "0" and limits["pids.max"] == "256"
    quota, period = limits["cpu.max"].split()
    assert quota != "max" and int(quota) == 2 * int(period)
    record(name + "-effective-cgroup", limits)


def create(kind, image, network):
    name = PREFIX + "-" + kind
    run(["docker", "create", "--name", name, "--label", "cupmemo.issue11=" + PREFIX, "--network", network, "--memory=3g", "--memory-swap=3g", "--cpus=2", "--pids-limit=256", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--mount", "type=bind,src=" + str(WORK) + ",dst=/work", "--entrypoint", "/usr/bin/sleep", image, "infinity"])
    OWNED.append(name)
    run(["docker", "start", name])
    fence(name, network)
    assert run(["docker", "exec", name, "/usr/local/bin/node", "--version"]) == "v24.15.0"
    return name


def command(name, args, cwd="/work/source", timeout=1200):
    # Fresh explicit environment, not inherited Docker/runner credentials/config.
    return run(["docker", "exec", "--workdir", cwd, name, "/usr/bin/env", "-i", *[k + "=" + v for k, v in ENV.items()], *args], timeout=timeout)


def resources(name):
    result = run(["docker", "exec", name, "/usr/local/bin/node", "-e", "const f=require('fs'),v={};for(const k of ['memory.peak','memory.events','memory.current']){try{v[k]=f.readFileSync('/sys/fs/cgroup/'+k,'utf8').trim()}catch{v[k]=null}}console.log(JSON.stringify(v))"])
    record(name + "-resources", json.loads(result))


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert platform.machine() == "aarch64", "hosted ARM64 only; no local fallback"
    assert os.environ.get("GITHUB_REPOSITORY") == "ohjy1006kenneth/CupMemo"
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=False)
    memory_match = re.search(r"^MemAvailable:\s+(\d+)", Path("/proc/meminfo").read_text(), re.M)
    assert memory_match is not None
    available = int(memory_match[1]) * 1024
    disks = {p: shutil.disk_usage(p).free for p in (str(WORK), "/var/lib/docker")}
    record("admission", {"available_memory_bytes": available, "free_disk_bytes": disks})
    assert available >= 4 * 1024**3 and min(disks.values()) >= 8 * 1024**3
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    head = run(["git", "rev-parse", "HEAD"])
    expected = event.get("pull_request", {}).get("head", {}).get("sha", os.environ["GITHUB_SHA"])
    assert head == expected, "checkout must be actual PR head, not synthetic merge"
    record("publication", {"head": head, "tree": run(["git", "rev-parse", "HEAD^{tree}"]), "event_sha": os.environ["GITHUB_SHA"], "pr_head": expected, "run_id": os.environ["GITHUB_RUN_ID"], "attempt": os.environ["GITHUB_RUN_ATTEMPT"], "runner_arch": platform.machine(), "provenance": LOCK["provenance"]})
    assert not run(["git", "status", "--porcelain"])
    download("archive", WORK / "source.tar.gz", {"codeload.github.com"}, 1024**2)
    download("go", WORK / "go.tar.gz", {"go.dev", "dl.google.com"}, 70 * 1024**2)
    download("message_bus", WORK / "message-bus.yaml", {"raw.githubusercontent.com"}, 1024**2)
    record("source-materialization", materialize(BUNDLE, WORK / "source.tar.gz", WORK / "source"))
    record("toolchain-extraction", extract_regular(WORK / "go.tar.gz", WORK / "go", "go", limit=600 * 1024**2, toolchain=True))
    for folder in ("home", "tmp", "bin", "cache", "modules", "generator", "artifact"):
        (WORK / folder).mkdir()
    # Public task data only: allow cap-drop ALL container-root to create build
    # outputs without granting the runner chown/sudo or mounting host config.
    for directory in [WORK, *[p for p in WORK.rglob("*") if p.is_dir()]]:
        directory.chmod(0o777)
    run(["docker", "pull", "--platform=linux/arm64", LOCK["node_image"]], timeout=300)
    image = json.loads(run(["docker", "image", "inspect", LOCK["node_image"]]))[0]
    assert image["Os"] == "linux" and image["Architecture"] == "arm64"
    manifest = json.loads(run(["docker", "buildx", "imagetools", "inspect", "--raw", LOCK["node_image"]]))
    assert any(p["digest"] == LOCK["node_arm64_manifest"] and p["platform"]["architecture"] == "arm64" for p in manifest["manifests"])
    record("node-image", {"index": LOCK["node_image"], "arm64_manifest": LOCK["node_arm64_manifest"], "image_id": image["Id"]})
    builder = create("build", image["Id"], "bridge")
    command(builder, ["go", "version"])
    go_files = [r["path"] for r in LOCK["patched_files"] if r["path"].endswith(".go")]
    # gofmt reads runner-owned inputs; the runner writes its own formatted bytes.
    # cap-drop ALL intentionally does not grant container root DAC override.
    for name in go_files:
        formatted_text = command(builder, ["gofmt", name]) + "\n"
        (WORK / "source" / name).write_text(formatted_text)
    formatted = EVIDENCE / "formatted-source"
    for record_ in LOCK["patched_files"]:
        dest = formatted / record_["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(WORK / "source" / record_["path"], dest)
    if any(identity(WORK / "source" / r["path"]) != {k: r[k] for k in ("bytes", "sha256")} for r in LOCK["patched_files"]):
        raise RuntimeError("gofmt checkpoint: adopt exported formatted source before ANY compilation; no build attempt consumed")
    command(builder, ["go", "install", LOCK["generator"]], cwd="/work/generator")
    (WORK / "source/codegen/message_bus").mkdir(parents=True)
    (WORK / "source/codegen").chmod(0o777)
    (WORK / "source/codegen/message_bus").chmod(0o777)
    command(builder, ["/work/bin/oapi-codegen", "-generate", "types,server,spec", "-package", "codegen", "-o", "codegen/app_management_api.go", "api/app_management/openapi.yaml"])
    command(builder, ["/work/bin/oapi-codegen", "-generate", "types,client", "-package", "message_bus", "-o", "codegen/message_bus/api.go", "/work/message-bus.yaml"])
    generated = ["api/app_management/openapi.yaml", "codegen/app_management_api.go", "codegen/message_bus/api.go"]
    record("codegen", {"generator": LOCK["generator"], "message_bus": LOCK["message_bus"], "files": [{"path": p, **identity(WORK / "source" / p)} for p in generated]})
    command(builder, ["go", "test", "-mod=readonly", "-p=1", "-c", "-o", "/work/artifact/service.test", "./service"])
    # Serial, one actual manager build; no retries or manager invocation.
    command(builder, ["go", "build", "-mod=readonly", "-p=1", "-trimpath", "-buildvcs=false", "-o", "/work/artifact/casaos-app-management-linux-arm64", "."])
    # Preserve genuine build output even if a later test fixture fails. Neither
    # retained artifact existence nor build success asserts test/live approval.
    metadata = command(builder, ["go", "version", "-m", "/work/artifact/casaos-app-management-linux-arm64"])
    (EVIDENCE / "binary-go-version-m.txt").write_text(metadata + "\n")
    binary = WORK / "artifact/casaos-app-management-linux-arm64"
    data = binary.read_bytes()
    assert data[:4] == b"\x7fELF" and data[4] == 2 and data[5] == 1 and int.from_bytes(data[18:20], "little") == 183
    shutil.copyfile(binary, EVIDENCE / binary.name)
    with (EVIDENCE / (binary.name + ".gz")).open("wb") as out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as compressed:
            compressed.write(data)
    record("binary", {"elf": identity(binary), "gzip": identity(EVIDENCE / (binary.name + ".gz")), "machine": "AArch64", "executed": False, "live_readiness": False})
    resources(builder)
    tester = create("test", image["Id"], "none")
    # Node's official image uses /usr/local/bin; the real production adapter is fixed
    # to /usr/bin/node. This symlink exists ONLY in the disposable test root.
    command(tester, ["/bin/ln", "-s", "/usr/local/bin/node", "/usr/bin/node"])
    tests = command(tester, ["go", "test", "-mod=readonly", "-p=1", "-count=1", "-timeout=120s", "./service", "-run", "^TestSyncthingPolicy", "-v"], timeout=180)
    assert "--- PASS: TestSyncthingPolicy" in tests and "no tests to run" not in tests and "FAIL" not in tests
    record("test-summary", {"top_level_passes": len(re.findall(r"^--- PASS: TestSyncthingPolicy", tests, re.M)), "subtest_passes": len(re.findall(r"^\s+--- PASS:", tests, re.M)), "network": "none", "scope": "real focused service package and actual Node helper; HTTP unexercised; fake Docker writers"})
    resources(tester)
    for rec in LOCK["module_files"] + LOCK["patched_files"]:
        checked(WORK / "source" / rec["path"], rec)
    record("full-final-source", [{"path": str(p.relative_to(WORK / "source")), **identity(p)} for p in sorted((WORK / "source").rglob("*")) if p.is_file()])
    # Independent fresh extraction/application proves the distributed cumulative patch.
    record("fresh-final-source", materialize(BUNDLE, WORK / "source.tar.gz", WORK / "fresh"))


if __name__ == "__main__":
    try:
        main()
    finally:
        cleanup = []
        for name in OWNED:
            try:
                resources(name)
                state = inspect(name)
                assert state["Config"]["Labels"]["cupmemo.issue11"] == PREFIX
                run(["docker", "rm", "--force", name], timeout=30)
                cleanup.append({"name": name, "oom_killed": state["State"]["OOMKilled"], "removed": True})
            except Exception as error:
                cleanup.append({"name": name, "cleanup_error_type": type(error).__name__})
        if EVIDENCE.exists():
            record("cleanup", cleanup)
            remaining = run(["docker", "ps", "-aq", "--filter", "label=cupmemo.issue11=" + PREFIX]) if OWNED else ""
            record("remaining-owned", {"ids": remaining})
            if remaining or any(not p.get("removed") for p in cleanup):
                raise RuntimeError("task-owned cleanup incomplete")
