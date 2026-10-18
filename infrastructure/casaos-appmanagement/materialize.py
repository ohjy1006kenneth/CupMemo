"""Pinned public-source materialization. No code/toolchain/service is executed here."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile


def identity(path):
    data = Path(path).read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def checked(path, record):
    assert identity(path) == {k: record[k] for k in ("bytes", "sha256")}, "public input identity mismatch"


def extract_regular(archive, destination, prefix, omitted=(), limit=100 * 1024 * 1024, toolchain=False):
    """Never follow/create source links. Toolchain links also fail closed."""
    destination = Path(destination)
    destination.mkdir(exist_ok=False)
    seen, skipped, total = set(), [], 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            name = member.name
            path = PurePosixPath(name)
            assert not path.is_absolute() and ".." not in path.parts, "unsafe archive member"
            assert path.parts and path.parts[0] == prefix, "unexpected archive root"
            normalized = str(path)
            assert normalized not in seen, "duplicate archive member"
            seen.add(normalized)
            relative = str(PurePosixPath(*path.parts[1:]))
            if relative == ".":
                assert member.isdir()
                continue
            if member.issym() and relative in omitted:
                skipped.append(relative)
                continue
            assert member.isdir() or member.isfile(), "nonregular archive member"
            target = destination / relative
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            total += member.size
            assert member.size <= 80 * 1024 * 1024 and total <= limit, "archive exceeds bound"
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                stream = source.extractfile(member)
                assert stream is not None
                remaining = member.size
                while remaining:
                    data = stream.read(min(remaining, 1024 * 1024))
                    assert data, "truncated member"
                    output.write(data)
                    remaining -= len(data)
            # Preserve executability only for the verified official toolchain, never setup scripts.
            target.chmod(0o755 if toolchain and member.mode & 0o111 else 0o644)
    assert set(skipped) == set(omitted), "omitted-link inventory changed"
    return {"omitted_symlinks": sorted(skipped), "regular_bytes": total}


def materialize(bundle, archive, destination):
    bundle = Path(bundle)
    lock = json.loads((bundle / "source-lock.json").read_text())
    checked(archive, lock["archive"])
    checked(bundle / lock["patch"]["path"], lock["patch"])
    receipt = extract_regular(archive, destination, "CasaOS-AppManagement-" + lock["upstream_commit"], lock["omitted_symlinks"])
    for record in lock["original_files"]:
        checked(Path(destination) / record["path"], record)
    subprocess.run(["git", "apply", "--check", str((bundle / lock["patch"]["path"]).resolve())], cwd=destination, check=True, timeout=10, env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"})
    subprocess.run(["git", "apply", str((bundle / lock["patch"]["path"]).resolve())], cwd=destination, check=True, timeout=10, env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"})
    for record in lock["patched_files"] + lock["module_files"]:
        checked(Path(destination) / record["path"], record)
    receipt["source_files"] = [{"path": str(p.relative_to(destination)), **identity(p)} for p in sorted(Path(destination).rglob("*")) if p.is_file()]
    return receipt
