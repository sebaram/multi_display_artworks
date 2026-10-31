"""Read-only production evidence. stdout contains identifiers, never env values."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

CONTAINER = "metamuseum_container"
MONGO = "mongo_container"
DATA = Path("/var/www/metamuseum/data")
ENV_FILE = DATA / "metamuseum.env"
MEDIA = {
    "static_splat": "/app/metamuseum/static/splat",
    "static_image": "/app/metamuseum/static/image",
    "static_gltf/matisse_dance.glb": "/app/metamuseum/static/gltf/matisse_dance.glb",
    "static_gltf/wheel.glb": "/app/metamuseum/static/gltf/wheel.glb",
    "streams": "/app/streams",
    "wall_media": "/app/wall_media",
}


class ReleaseError(RuntimeError):
    pass


def command(args, *, data=None, output=None):
    # Never echo argv, stderr, or Docker config: any of them can contain credentials.
    try:
        result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False)
    except OSError:
        raise ReleaseError("Required host executable is unavailable") from None
    if result.returncode:
        raise ReleaseError("Host operation failed; inspect private diagnostics on the host")
    return result.stdout


def inspect(kind, name):
    return json.loads(command(["docker", kind, "inspect", name]))[0]


def environment(container):
    return dict(entry.split("=", 1) for entry in container["Config"].get("Env", []) if "=" in entry)


def file_info(path):
    info = {"exists": path.exists(), "symlink": path.is_symlink()}
    if path.exists():
        value = path.stat()
        info.update(realpath=str(path.resolve()), type="file" if path.is_file() else "directory" if path.is_dir() else "other",
                    uid=value.st_uid, gid=value.st_gid, mode=oct(stat.S_IMODE(value.st_mode)))
        if path.is_file():
            info["bytes"] = value.st_size
    return info


def inventory(include_code=False):
    app = inspect("container", CONTAINER)
    image = inspect("image", app["Image"])
    mongo = inspect("container", MONGO)
    mongo_image = inspect("image", mongo["Image"])
    env = environment(app)
    labels = app["Config"].get("Labels") or {}
    image_labels = image["Config"].get("Labels") or {}
    report = {
        "container": CONTAINER, "container_id": app["Id"], "running": app["State"]["Running"],
        "image_id": app["Image"], "image_created": image.get("Created"),
        "source_revision": image_labels.get("org.opencontainers.image.revision"),
        "source_revision_status": "label_only_requires_verification" if image_labels.get("org.opencontainers.image.revision") else "unresolved_do_not_assume_974bbfd",
        "image_version": image_labels.get("org.opencontainers.image.version"),
        "image_source": image_labels.get("org.opencontainers.image.source"),
        "image_repo_digests": image.get("RepoDigests", []),
        "working_directory": app["Config"].get("WorkingDir"), "user": app["Config"].get("User"),
        "compose_project": labels.get("com.docker.compose.project"),
        "compose_service": labels.get("com.docker.compose.service"),
        "compose_files": labels.get("com.docker.compose.project.config_files"),
        "compose_working_directory": labels.get("com.docker.compose.project.working_dir"),
        "networks": sorted(app["NetworkSettings"].get("Networks", {})),
        "ports": app["NetworkSettings"].get("Ports"),
        "mounts": [{key: mount.get(key) for key in ("Type", "Source", "Destination", "RW")} for mount in app["Mounts"]],
        "expected_host_paths": {name: file_info(DATA / name) for name in MEDIA},
        "env_file": file_info(ENV_FILE),
        "required_runtime_keys_present": {key: bool(env.get(key)) for key in ("MONGODB_URI", "MONGODB_DB", "SECRET_KEY", "SECURITY_PASSWORD_SALT")},
        "mongo": {"container_id": mongo["Id"], "image_id": mongo["Image"], "running": mongo["State"]["Running"],
                  "networks": sorted(mongo["NetworkSettings"].get("Networks", {}))},
        "tools": {name: bool(shutil.which(name)) for name in ("docker", "python3", "tar", "sha256sum", "flock")},
        "disk_free_bytes": shutil.disk_usage(DATA if DATA.is_dir() else "/var/www").free,
        "host_python": sys.version.split()[0],
        "host_uid": os.geteuid(),
        "host_gid": os.getegid(),
        "warnings": ["Do not upload backups, environment files, or raw Docker/Compose inspection to CI artifacts.",
                     "UID permission/ACL write probes, source provenance, proxy restriction, and restore rehearsal are prepare/deploy gates."],
    }
    report["mongo"]["declared_volumes"] = sorted((mongo_image["Config"].get("Volumes") or {}))
    report["noninteractive_sudo"] = bool(shutil.which("sudo")) and subprocess.run(
        ["sudo", "-n", "true"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=10, check=False).returncode == 0
    report["media_sizes"] = {}
    for name in MEDIA:
        path = DATA / name
        files = [path] if path.is_file() else (
            (Path(base) / file for base, _, names in os.walk(path, followlinks=False) for file in names)
            if path.is_dir() else ())
        sizes = [file.stat().st_size for file in files if file.is_file() and not file.is_symlink()]
        report["media_sizes"][name] = {"files": len(sizes), "bytes": sum(sizes)}
    if ENV_FILE.is_file():
        report["env_file"]["sha256"] = hashlib.sha256(ENV_FILE.read_bytes()).hexdigest()
    for tool in ("mongodump", "mongorestore", "mongosh", "mongod"):
        try:
            report["mongo"][tool] = command(["docker", "exec", MONGO, tool, "--version"]).decode().splitlines()[0]
        except ReleaseError:
            report["mongo"][tool] = "unavailable"
    if include_code:
        # Hash code only, excluding environment/config files and dependency/cache trees.
        code = """import hashlib,json,os
from pathlib import Path
root=Path('/app'); result={}
for base, dirs, files in os.walk(root):
 dirs[:]=sorted(d for d in dirs if d not in ('node_modules','__pycache__','.git','.venv','wall_media','streams') and not d.startswith('.'))
 for name in sorted(files):
  p=Path(base)/name
  if p.suffix in ('.py','.js','.html') and not p.is_symlink(): result[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps(result,sort_keys=True))
"""
        report["code_manifest"] = json.loads(command(["docker", "exec", "-e", "PYTHONDONTWRITEBYTECODE=1", CONTAINER, "python", "-c", code]))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code-manifest", action="store_true", help="Also hash .py/.js/.html under /app; no source contents are printed")
    args = parser.parse_args()
    try:
        print(json.dumps(inventory(args.code_manifest), indent=2, sort_keys=True))
    except (ReleaseError, OSError, ValueError, KeyError):
        print("Inventory failed. No release changes were attempted; verify Docker access and host layout.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
