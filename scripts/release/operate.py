"""Explicit host-only preparation/cutover. No push event calls these operations."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import signal
import socket
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

from inventory import CONTAINER, MONGO, DATA, ENV_FILE, MEDIA, ReleaseError, command, environment, inspect

IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
CHECKS = (
    "legacy_restored_snapshot_health_gallery_and_media",
    "candidate_staging_login_and_preserved_auth",
    "existing_ids_references_order_and_indexes",
    "candidate_room_wall_image_splat_and_both_gltf_files",
    "candidate_preset_upload_apply_and_restart_persistence",
    "candidate_two_visitors_realtime_and_shared_mp4",
    "private_port_acceptance_access_ready",
)
PRIVATE_CHECKS = ("health", "staging_login_and_preserved_auth", "live_room_wall_image_splat_gltf", "live_two_visitors_realtime",
                  "staging_preset_upload_apply_restart", "staging_shared_mp4_and_live_clock")


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def require_path(path, *, is_file=False):
    path = Path(path)
    require(not path.is_symlink(), "A required host path is a symlink")
    require(path.is_file() if is_file else path.is_dir(), "A required host path is missing or has the wrong type")
    require(all(not parent.is_symlink() for parent in path.parents), "A required host path has a symlink ancestor")


def assert_isolated(path, live_paths):
    path = Path(path)
    require(path.is_absolute(), "Release paths must be absolute")
    for live in live_paths:
        live = Path(live).resolve()
        resolved = path.resolve()
        require(resolved != live and live not in resolved.parents and resolved not in live.parents,
                "Release/staging paths must not overlap a live mount")
    require(not path.is_symlink() and all(not p.is_symlink() for p in path.parents), "Release paths must not traverse symlinks")


def guarded_switch(preflight, switch, rollback):
    # Preflight runs outside the handler: it can never select a stale rollback image.
    preflight()
    try:
        return switch()
    except BaseException:
        rollback()
        raise


def recovery_action(original, current, candidate_image):
    if current and current["Id"] == original["Id"] and current["Image"] == original["Image"]:
        return "resume"
    require(current is None or current["Image"] == candidate_image, "Unexpected container/image appeared; automatic rollback refused")
    return "rollback"


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def save(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")


def stream_command(args, *, source=None, target=None):
    result = subprocess.run(args, stdin=source, stdout=target or subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, "A private backup/restore operation failed; release remains gated")
    return result.stdout


def compose(path):
    return ["docker", "compose", "-p", "metamuseum", "-f", str(path)]


def require_port_free(port):
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    except OSError:
        raise ReleaseError("A required private loopback port is already occupied") from None


def validate_candidate_compose(candidate, env):
    require(set(candidate["services"]) == {"app"}, "Candidate Compose must contain one app service")
    service = candidate["services"]["app"]
    require(service.get("container_name") == CONTAINER and service.get("deploy", {}).get("replicas", 1) == 1,
            "Candidate Compose must preserve the container name and one replica")
    require(not service.get("command") and not service.get("entrypoint"), "Candidate Compose must preserve the verified one-worker image command")
    mounts = service.get("volumes", [])
    require(len(mounts) == len(MEDIA), "Candidate Compose has unexpected media mounts")
    by_target = {mount["target"]: mount for mount in mounts}
    for name, destination in MEDIA.items():
        mount = by_target.get(destination, {})
        require(mount.get("type") == "bind" and Path(mount.get("source", "/")).resolve() == (DATA / name).resolve(),
                "Candidate media mounts differ from the reviewed live paths")
    ports = service.get("ports", [])
    require(len(ports) == 1 and ports[0].get("host_ip") == "127.0.0.1" and str(ports[0].get("published")) == "51736"
            and ports[0].get("target") == 5000, "Candidate port must remain loopback-only 51736")
    network_keys = list(service.get("networks", {}))
    require(len(network_keys) == 1 and candidate.get("networks", {}).get(network_keys[0], {}).get("name") == "tlx-mongo_default"
            and candidate["networks"][network_keys[0]].get("external") is True, "Candidate must use the existing external Mongo network")
    configured = service.get("environment", {})
    require(all(configured.get(key) == env[key] for key in ("MONGODB_URI", "MONGODB_DB", "SECRET_KEY", "SECURITY_PASSWORD_SALT")),
            "Candidate database or authentication secrets differ from the rehearsed production configuration")
    require(configured.get("ENVIRONMENT") == "production", "Candidate must enforce the production environment")
    for key, expected in (("WALL_MEDIA_ROOT", "/app/wall_media"), ("STREAM_ROOT", "/app/streams"), ("MEDIA_ROOT", "/app/metamuseum/static")):
        require(configured.get(key, expected) == expected, "Candidate media environment overrides a reviewed mount")


def validate_media(allow_missing_wall_media=False):
    require_path(DATA)
    require_path(ENV_FILE, is_file=True)
    for name in MEDIA:
        path = DATA / name
        if name == "wall_media" and allow_missing_wall_media and not path.exists() and not path.is_symlink():
            continue
        require_path(path, is_file=name.endswith(".glb"))
        if path.is_dir():
            for base, directories, files in os.walk(path):
                require(all(not (Path(base) / entry).is_symlink() for entry in directories + files),
                        "Media contains a symlink; resolve it before taking an isolated copy")


def validate_current_mounts(mounts):
    by_target = {mount["Destination"]: mount for mount in mounts}
    expected_count = len(MEDIA) if MEDIA["wall_media"] in by_target else len(MEDIA) - 1
    require(len(mounts) == expected_count, "Unreviewed production mounts require explicit inspection")
    for name, destination in MEDIA.items():
        if name == "wall_media" and destination not in by_target:
            continue  # The verified Flask deployment has five mounts and no wall uploads yet.
        mount = by_target.get(destination, {})
        require(mount.get("Type") == "bind" and Path(mount.get("Source", "/")).resolve() == (DATA / name).resolve(),
                "Production media mounts differ from the reviewed host paths")


def ensure_wall_media():
    path = DATA / "wall_media"
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o770)
        set_app_owner(path)
        os.chmod(path, 0o770)
    require_path(path)
    uid_write_probe(path)


def set_app_owner(path):
    owner = path.stat()
    if (owner.st_uid, owner.st_gid) != (1000, 1000):
        require(os.geteuid() == 0, "Copied media must already belong to the operating UID/GID1000")
        os.chown(path, 1000, 1000)


def uid_write_probe(path):
    # UID1000 probes directly; root may drop identity only in a short-lived child.
    if os.geteuid() == 1000:
        probe = path / (".release-write-probe-" + str(os.getpid()))
        try:
            descriptor = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            probe.unlink()
        except OSError:
            raise ReleaseError("UID1000 cannot write streams or wall_media") from None
        return
    require(os.geteuid() == 0, "Write probes require the reviewed UID1000 or root")
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(1000)
            os.setuid(1000)
            probe = path / (".release-write-probe-" + str(os.getpid()))
            descriptor = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            probe.unlink()
        except OSError:
            os._exit(1)
        os._exit(0)
    _, status = os.waitpid(pid, 0)
    require(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, "UID1000 cannot write streams or wall_media")


def probe_candidate_database(candidate):
    # Staging uses a no-auth copy; prove the new driver accepts the real URI before any stop.
    code = ("from metamuseum.config import Settings; "
            "from metamuseum.db import connect_database, disconnect_database; "
            "connection=connect_database(Settings()); connection.admin.command('ping'); disconnect_database()")
    command(["docker", "run", "--rm", "--read-only", "--network", "tlx-mongo_default",
             "--env-file", str(ENV_FILE), "--entrypoint", "python", candidate, "-c", code])


def import_candidate_presets(container):
    code = ("from metamuseum.config import Settings\n"
            "from metamuseum.db import connect_database, disconnect_database\n"
            "from metamuseum.services.wall_designs import import_defaults\n"
            "settings=Settings(); connect_database(settings)\n"
            "try:\n assert import_defaults(settings)==44\n"
            "finally:\n disconnect_database()\n")
    command(["docker", "exec", container, "python", "-c", code])


def preflight(expected_image, candidate, candidate_sha, *, allow_missing_wall_media=False):
    require(IMAGE_ID.fullmatch(expected_image) is not None and IMAGE_ID.fullmatch(candidate) is not None,
            "Both production and candidate must use immutable sha256 image IDs")
    require(SHA.fullmatch(candidate_sha) is not None, "Candidate source SHA must be the complete commit ID")
    app = inspect("container", CONTAINER)
    mongo = inspect("container", MONGO)
    require(app["State"]["Running"] and mongo["State"]["Running"], "Production app and Mongo must be running before preparation")
    require(app["Image"] == expected_image, "Production image changed since inventory")
    require("tlx-mongo_default" in app["NetworkSettings"]["Networks"] and
            "tlx-mongo_default" in mongo["NetworkSettings"]["Networks"], "Expected external Mongo network is absent")
    require(app["NetworkSettings"]["Ports"].get("5000/tcp") == [{"HostIp": "127.0.0.1", "HostPort": "51736"}],
            "Production loopback port differs from the reviewed layout")
    validate_media(allow_missing_wall_media)
    validate_current_mounts(app["Mounts"])
    env = environment(app)
    require(all(env.get(key) and not env[key].startswith(("change-me", "replace-with"))
                for key in ("SECRET_KEY", "SECURITY_PASSWORD_SALT", "MONGODB_URI", "MONGODB_DB")),
            "Production runtime secrets/database settings are incomplete")
    from urllib.parse import urlsplit
    uri = urlsplit(env["MONGODB_URI"])
    require(uri.scheme == "mongodb" and uri.hostname == MONGO and uri.port in (None, 27017)
            and uri.path == "/" + env["MONGODB_DB"] and re.fullmatch(r"[A-Za-z0-9_-]+", env["MONGODB_DB"]),
            "Production Mongo URI requires a reviewed single-host database configuration")
    candidate_info = inspect("image", candidate)
    labels = candidate_info["Config"].get("Labels") or {}
    require(labels.get("org.opencontainers.image.revision") == candidate_sha and
            re.fullmatch(r"2\.0\.0(?:-rc\.[1-9][0-9]*)?", labels.get("org.opencontainers.image.version", "")),
            "Candidate image lacks matching source SHA and approved release version labels")
    require(candidate_info["Config"].get("User") in ("appuser", "1000", "1000:1000"), "Candidate image must run as UID1000")
    args = candidate_info["Config"].get("Cmd") or []
    require("--workers" in args and args[args.index("--workers") + 1:args.index("--workers") + 2] == ["1"],
            "Candidate image must use one Uvicorn worker")
    for tool in ("mongodump", "mongorestore", "mongosh"):
        command(["docker", "exec", MONGO, tool, "--version"])
    require(b"--config" in command(["docker", "exec", MONGO, "mongodump", "--help"]),
            "mongodump must support --config to keep credentials out of process arguments")
    uid_write_probe(DATA / "streams")
    if (DATA / "wall_media").exists():
        uid_write_probe(DATA / "wall_media")
    probe_candidate_database(candidate)
    return app, mongo, env


def original_compose(app, directory):
    labels = app["Config"].get("Labels") or {}
    require(labels.get("com.docker.compose.project") == "metamuseum" and labels.get("com.docker.compose.service") == "app",
            "Production must have the reviewed Compose project/service labels")
    files = (labels.get("com.docker.compose.project.config_files") or "").split(",")
    require(files and all(Path(path).is_file() for path in files), "Original running Compose inputs are unavailable")
    args = ["docker", "compose", "-p", "metamuseum"]
    workdir = labels.get("com.docker.compose.project.working_dir")
    if workdir:
        args.extend(["--project-directory", workdir])
    for index, path in enumerate(files):
        args.extend(["-f", path])
        shutil.copy2(path, directory / ("compose-input-" + str(index) + ".yml"))
    resolved = json.loads(command(args + ["config", "--format", "json"]))
    require(set(resolved["services"]) == {"app"}, "Original Compose has unreviewed services")
    service = resolved["services"]["app"]
    configured_mounts = {(mount["type"], mount["source"], mount["target"]) for mount in service.get("volumes", [])}
    actual_mounts = {(mount["Type"], mount["Source"], mount["Destination"]) for mount in app["Mounts"]}
    require(configured_mounts == actual_mounts, "Original Compose mounts changed since the running container was created")
    service.pop("build", None)
    service.pop("env_file", None)
    service["image"] = app["Image"]
    service["environment"] = environment(app)
    # These came from the running container, not a subsequently edited checkout.
    for source, target in (("Cmd", "command"), ("Entrypoint", "entrypoint"), ("WorkingDir", "working_dir"), ("User", "user")):
        service[target] = app["Config"].get(source) or ([] if source in ("Cmd", "Entrypoint") else "")
    require(service.get("container_name") == CONTAINER, "Original Compose container identity differs")
    save(directory / "compose.original.json", resolved)
    save(directory / "container.inspect.json", app)
    shutil.copy2(ENV_FILE, directory / "metamuseum.env")


def mongo_summary(env, container=MONGO, isolated=False):
    uri = "mongodb://mongo_container:27017/" + env["MONGODB_DB"] if isolated else env["MONGODB_URI"]
    script = "const database=connect(" + json.dumps(uri) + "); print(JSON.stringify(database.getCollectionNames().sort().map(n=>({name:n,count:database.getCollection(n).countDocuments({}),indexes:database.getCollection(n).getIndexes()}))));"
    return json.loads(command(["docker", "exec", "-i", container, "mongosh", "--quiet", "--nodb", "--file", "/dev/stdin"], data=script.encode()))


def require_snapshot_space(directory, app, env):
    script = "const d=connect(" + json.dumps(env["MONGODB_URI"]) + "); const s=d.stats(); print(JSON.stringify({bytes:Math.max(s.dataSize,s.storageSize)+s.indexSize}));"
    database_bytes = json.loads(command(["docker", "exec", "-i", MONGO, "mongosh", "--quiet", "--nodb", "--file", "/dev/stdin"], data=script.encode()))["bytes"]
    media_bytes = sum(path.stat().st_size for name in MEDIA for path in ([DATA / name] if (DATA / name).is_file() else (DATA / name).rglob("*")) if path.is_file())
    # One snapshot and two isolated restores, plus a later final snapshot and headroom.
    needed = inspect("image", app["Image"])["Size"] + 4 * (media_bytes + database_bytes) + 2 * 1024**3
    parent = directory
    while not parent.exists():
        parent = parent.parent
    require(shutil.disk_usage(parent).free >= needed, "Insufficient release-volume space for image, paired copies, final snapshot, and reserve")


def snapshot(directory, app, env, *, restart):
    directory.mkdir(mode=0o700)
    # Only this app is stopped. No global fsync lock is taken on the shared Mongo server.
    try:
        command(["docker", "stop", "--time", "30", app["Id"]])
        require(not inspect("container", app["Id"])["State"]["Running"], "App did not stop; snapshot refused")
        print("App writes stopped; taking paired Mongo/media snapshot.", flush=True)
        with (directory / "mongo.archive.gz").open("xb") as output:
            command(["docker", "exec", "-i", MONGO, "mongodump", "--config=/dev/stdin", "--archive", "--gzip", "--db", env["MONGODB_DB"]],
                    data=json.dumps({"uri": env["MONGODB_URI"]}).encode(), output=output)
        save(directory / "collections.json", mongo_summary(env))
        validate_media()
        with tarfile.open(directory / "media.tar", "x") as archive:
            for name in MEDIA:
                archive.add(DATA / name, arcname=name, recursive=True)
        hashes = {name: digest(directory / name) for name in ("mongo.archive.gz", "media.tar", "collections.json")}
        save(directory / "snapshot.json", {"production_image": app["Image"], "container_id": app["Id"], "completed_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sha256": hashes})
    finally:
        if restart and not inspect("container", app["Id"])["State"]["Running"]:
            command(["docker", "start", app["Id"]])
            wait_health(51736)


def extract_media(archive_path, target):
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        for member in members:
            name = PurePosixPath(member.name)
            require(not name.is_absolute() and ".." not in name.parts and (member.isfile() or member.isdir()),
                    "Backup contains unsafe paths or links")
            require(any(member.name == name or member.name.startswith(name + "/") for name in MEDIA),
                    "Backup contains an unexpected media root")
        target.mkdir(parents=True, mode=0o700)
        # Extract only verified regular files/directories; no version-dependent tar filters.
        for member in members:
            destination = target / member.name
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output)
            os.chmod(destination, member.mode & 0o777)


def wait_mongo(container):
    for _ in range(60):
        try:
            command(["docker", "exec", container, "mongosh", "--quiet", "--eval", "quit(db.adminCommand({ping:1}).ok?0:1)"])
            return
        except ReleaseError:
            time.sleep(1)
    raise ReleaseError("Isolated Mongo did not become ready")


def wait_health(port):
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:" + str(port) + "/health", timeout=3) as response:
                if response.status == 200:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise ReleaseError("Application health check failed")


def mongo_bind_paths(stage, declared_volumes):
    require(set(declared_volumes) <= {"/data/db", "/data/configdb"}, "Mongo image declares an unreviewed persistent volume")
    assert_isolated(stage, [DATA])
    return {"/data/db": stage / "mongo", "/data/configdb": stage / "mongo-configdb"}


def staging(directory, token, role, image, mongo_image, env, port, app):
    network = "metamuseum-release-" + token + "-" + role
    mongo_name = network + "-mongo"
    app_name = network + "-app"
    stage = directory / ("staging-" + role)
    stage.mkdir(mode=0o700)
    extract_media(directory / "snapshot" / "media.tar", stage / "media")
    for base, directories, files in os.walk(stage / "media"):
        set_app_owner(Path(base))
        for name in files:
            set_app_owner(Path(base) / name)
    mongo_paths = mongo_bind_paths(stage, inspect("image", mongo_image)["Config"].get("Volumes") or {})
    for path in mongo_paths.values():
        path.mkdir(mode=0o700)
    command(["docker", "network", "create", "--internal", "--label", "metamuseum.release=" + token, network])
    mongo_args = ["docker", "run", "-d", "--name", mongo_name, "--label", "metamuseum.release=" + token, "--network", network,
                  "--network-alias", "mongo_container"]
    for destination, source in mongo_paths.items():
        mongo_args.extend(["--mount", "type=bind,src=" + str(source) + ",dst=" + destination])
    command(mongo_args + [mongo_image, "--bind_ip_all", "--noauth"])
    wait_mongo(mongo_name)
    with (directory / "snapshot" / "mongo.archive.gz").open("rb") as source:
        stream_command(["docker", "exec", "-i", mongo_name, "mongorestore", "--archive", "--gzip", "--nsInclude", env["MONGODB_DB"] + ".*"], source=source)
    require(mongo_summary(env, mongo_name, isolated=True) == json.loads((directory / "snapshot" / "collections.json").read_text()),
            "Restored collection counts/indexes differ from the paired snapshot")
    stage_env = dict(env, MONGODB_URI="mongodb://mongo_container:27017/" + env["MONGODB_DB"], MONGODB_HOST="mongo_container",
                     MONGODB_PORT="27017", WALL_MEDIA_ROOT="/app/wall_media", STREAM_ROOT="/app/streams",
                     SECRET_KEY=secrets.token_urlsafe(48), SECURITY_PASSWORD_SALT=secrets.token_urlsafe(48))
    if role == "candidate":
        for key in ("PATH", "PYTHONPATH", "PYTHON_VERSION", "PYTHON_PIP_VERSION", "PYTHON_GET_PIP_URL", "PYTHON_GET_PIP_SHA256", "GPG_KEY"):
            stage_env.pop(key, None)
        stage_env.update(ENVIRONMENT="production", MEDIA_ROOT="/app/metamuseum/static", FRONTEND_ROOT="/app/web",
                         ALLOWED_ORIGINS=json.dumps(["http://localhost:" + str(port), "http://127.0.0.1:" + str(port)]))
    require(all("\n" not in value and "\r" not in value for value in stage_env.values()), "Multiline runtime environment requires an explicit export procedure")
    env_path = stage / "app.env"
    env_path.write_text("".join(key + "=" + value + "\n" for key, value in stage_env.items()))
    args = ["docker", "run", "-d", "--name", app_name, "--label", "metamuseum.release=" + token, "--network", network,
            "-p", "127.0.0.1:" + str(port) + ":5000", "--env-file", str(env_path)]
    for name, destination in MEDIA.items():
        if role == "legacy" and destination not in {mount["Destination"] for mount in app["Mounts"]}:
            continue
        source = stage / "media" / name
        assert_isolated(source, [DATA])
        args.extend(["--mount", "type=bind,src=" + str(source) + ",dst=" + destination + (",readonly" if name.startswith("static_") else "")])
    if role == "legacy":
        # Preserve command/entrypoint overrides from the running legacy container.
        entrypoint = app["Config"].get("Entrypoint") or []
        args.extend(["--entrypoint", entrypoint[0] if entrypoint else ""])
        if app["Config"].get("User"):
            args.extend(["--user", app["Config"]["User"]])
        if app["Config"].get("WorkingDir"):
            args.extend(["--workdir", app["Config"]["WorkingDir"]])
        args.extend([image] + entrypoint[1:] + (app["Config"].get("Cmd") or []))
    else:
        args.append(image)
    command(args)
    wait_health(port)
    save(stage / "resources.json", {"network": network, "mongo_container": mongo_name, "app_container": app_name, "image": image, "loopback_port": port,
         "mongo_bind_paths": {destination: str(source) for destination, source in mongo_paths.items()}})


def prepare(args):
    require(args.confirm_exclusive_app_writer, "Confirm no other writer mutates this database/media during app stop")
    require(SHA.fullmatch(args.production_sha) is not None, "Actual production source SHA must be resolved before prepare")
    require_path(args.production_sha_evidence, is_file=True)
    app, mongo, env = preflight(args.expected_production_image, args.candidate_image, args.candidate_sha, allow_missing_wall_media=True)
    actual_revision = (inspect("image", app["Image"])["Config"].get("Labels") or {}).get("org.opencontainers.image.revision")
    require(not actual_revision or actual_revision == args.production_sha, "Production source SHA conflicts with its image label")
    directory = args.release_dir
    assert_isolated(directory, [DATA] + [mount["Source"] for mount in mongo["Mounts"] if mount.get("Source")])
    require(not directory.exists(), "Use a new private release directory for each preparation attempt")
    require(args.staging_port != args.rollback_port and all(1024 <= port <= 65535 and port != 51736 for port in (args.staging_port, args.rollback_port)),
            "Staging ports must be distinct unprivileged loopback ports outside production")
    require_port_free(args.staging_port)
    require_port_free(args.rollback_port)
    require_snapshot_space(directory, app, env)
    directory.mkdir(parents=True, mode=0o700)
    original_compose(app, directory)
    save(directory / "mongo.inspect.json", mongo)
    shutil.copy2(args.production_sha_evidence, directory / "production-source-evidence.txt")
    print("Archiving the actual production image before the brief app stop.", flush=True)
    command(["docker", "image", "save", "--output", str(directory / "production-image.tar"), app["Image"]])
    ensure_wall_media()
    snapshot(directory / "snapshot", app, env, restart=True)
    print("Original app restarted; restoring independent candidate and legacy copies.", flush=True)
    token = hashlib.sha256(str(directory).encode()).hexdigest()[:12]
    staging(directory, token, "candidate", args.candidate_image, mongo["Image"], env, args.staging_port, app)
    staging(directory, token, "legacy", app["Image"], mongo["Image"], env, args.rollback_port, app)
    manifest = {"production_image": app["Image"], "production_sha": args.production_sha,
                "candidate_image": args.candidate_image, "candidate_sha": args.candidate_sha, "mongo_image": mongo["Image"],
                "prepared_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sha256": {name: digest(directory / name) for name in ("production-image.tar", "compose.original.json", "metamuseum.env", "production-source-evidence.txt", "snapshot/snapshot.json")}}
    save(directory / "prepared.json", manifest)
    save(directory / "operator-checks.required.json", {"release_dir": str(directory), "prepared_sha256": digest(directory / "prepared.json"),
         "candidate_image": args.candidate_image, "candidate_sha": args.candidate_sha,
         "operator": "", "evidence": "", "checks": {name: False for name in CHECKS}})
    print("Preparation complete. Keep backups private on this host. Complete operator-checks.json from the required template before manual cutover.", flush=True)


def verify_prepared(directory):
    assert_isolated(directory, [DATA])
    require_path(directory)
    require(directory.stat().st_mode & 0o077 == 0, "Release directory must be private (mode 0700)")
    manifest = json.loads((directory / "prepared.json").read_text())
    for name, expected in manifest["sha256"].items():
        require(digest(directory / name) == expected, "Prepared immutable backup/config checksum changed")
    paired = json.loads((directory / "snapshot" / "snapshot.json").read_text())
    for name, expected in paired["sha256"].items():
        require(digest(directory / "snapshot" / name) == expected, "Prepared paired snapshot checksum changed")
    checks = json.loads((directory / "operator-checks.json").read_text())
    require(checks.get("release_dir") == str(directory) and checks.get("prepared_sha256") == digest(directory / "prepared.json"),
            "Operator checks belong to another preparation attempt")
    require(checks.get("candidate_image") == manifest["candidate_image"] and checks.get("candidate_sha") == manifest["candidate_sha"],
            "Operator checks refer to a different candidate")
    require(bool(checks.get("operator")) and bool(checks.get("evidence")) and all(checks.get("checks", {}).get(name) is True for name in CHECKS),
            "All rehearsal and operator-access checks must be recorded before deploy")
    return manifest


def deploy(args):
    require(args.manual_cutover_approved and args.confirm_exclusive_app_writer,
            "Manual private cutover and exclusive writer gates are required")
    require(1024 <= args.private_port <= 65535 and args.private_port != 51736, "Private cutover port must differ from public production")
    require_port_free(args.private_port)
    directory = args.release_dir
    manifest = verify_prepared(directory)
    app, mongo, env = preflight(manifest["production_image"], manifest["candidate_image"], manifest["candidate_sha"])
    assert_isolated(directory, [DATA] + [mount["Source"] for mount in mongo["Mounts"] if mount.get("Source")])
    # Never reuse a prior execution's final snapshot or rollback baseline.
    attempt = directory / ("cutover-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + str(os.getpid()))
    attempt.mkdir(mode=0o700)
    original_compose(app, attempt)
    candidate = json.loads(command(["docker", "compose", "-f", str(args.candidate_compose), "config", "--format", "json"]))
    validate_candidate_compose(candidate, env)
    service = candidate["services"]["app"]
    service.pop("build", None)
    service.pop("env_file", None)
    service["image"] = manifest["candidate_image"]
    save(attempt / "compose.public.json", candidate)
    private = json.loads(json.dumps(candidate))
    private_service = private["services"]["app"]
    private_service["ports"][0]["published"] = str(args.private_port)
    origins = json.loads(private_service["environment"].get("ALLOWED_ORIGINS", "[]"))
    private_service["environment"]["ALLOWED_ORIGINS"] = json.dumps(list(dict.fromkeys(origins +
        ["http://localhost:" + str(args.private_port), "http://127.0.0.1:" + str(args.private_port)])))
    save(attempt / "compose.private.json", private)

    def final_backup():
        try:
            snapshot(attempt / "snapshot", app, env, restart=False)
            save(attempt / "switch-started.json", {"old_image": app["Image"], "candidate_image": manifest["candidate_image"]})
        except BaseException:
            # The image switch has not begun: only resume this exact original container.
            if not inspect("container", app["Id"])["State"]["Running"]:
                command(["docker", "start", app["Id"]])
            raise

    def switch():
        command(compose(attempt / "compose.private.json") + ["up", "-d", "--no-build", "--pull", "never", "--no-deps", "app"])
        require(inspect("container", CONTAINER)["Image"] == manifest["candidate_image"], "Running image differs from approved candidate")
        wait_health(args.private_port)
        import_candidate_presets(CONTAINER)
        require_port_free(51736)
        held = {"release_dir": str(directory), "original_container_id": app["Id"], "production_image": app["Image"],
                "candidate_image": manifest["candidate_image"], "candidate_sha": manifest["candidate_sha"],
                "private_port": args.private_port, "private_app_container": CONTAINER, "snapshot": str(attempt / "snapshot"),
                "held_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sha256": {name: digest(attempt / name) for name in ("compose.original.json", "compose.private.json", "compose.public.json", "container.inspect.json", "snapshot/snapshot.json")}}
        save(attempt / "hold.json", held)
        save(attempt / "private-operator-checks.required.json", {"attempt_dir": str(attempt), "hold_sha256": digest(attempt / "hold.json"),
             "candidate_image": manifest["candidate_image"], "candidate_sha": manifest["candidate_sha"],
             "operator": "", "evidence": "", "checks": {name: False for name in PRIVATE_CHECKS}})

    guarded_switch(final_backup, switch, lambda: restore_original(attempt, app, manifest["candidate_image"]))
    print("Candidate held on private loopback port " + str(args.private_port) + "; public port51736 is closed. Run private acceptance, then explicitly promote or rollback using this attempt directory: " + str(attempt), flush=True)


def restore_original(attempt, app, candidate_image):
    ids = command(["docker", "container", "ls", "--all", "--filter", "name=^/" + CONTAINER + "$", "--format", "{{.ID}}"])
    current = inspect("container", CONTAINER) if ids.strip() else None
    if recovery_action(app, current, candidate_image) == "resume":
        command(["docker", "start", app["Id"]])
        wait_health(51736)
        save(attempt / "original-resumed.json", {"container_id": app["Id"], "image_switch_occurred": False})
        print("Original container is intact and was resumed; no Compose rollback was applied.", flush=True)
        return
    print("Restoring this attempt's captured original image/config. Paired data snapshot is retained separately.", flush=True)
    # Stop first so there is never a second live app replica during restore.
    if current and current["State"]["Running"]:
        command(["docker", "stop", "--time", "30", current["Id"]])
    command(compose(attempt / "compose.original.json") + ["up", "-d", "--no-build", "--pull", "never", "--no-deps", "app"])
    require(inspect("container", CONTAINER)["Image"] == app["Image"], "Rollback image verification failed")
    wait_health(51736)
    save(attempt / "code-rollback.json", {"restored_image": app["Image"], "data_restored": False,
         "paired_final_snapshot": str(attempt / "snapshot"), "note": "Code/config rollback only. Assess paired data restore separately."})


def validate_hold_container(held, current, attempt, *, allow_inactive=False, published=False):
    require(current["Image"] == held["candidate_image"], "Current image differs from the held candidate")
    running = current["State"]["Running"]
    require(running or allow_inactive, "The held candidate is not running")
    ports = current["NetworkSettings"]["Ports"] if running else current["HostConfig"]["PortBindings"]
    port = 51736 if published else held["private_port"]
    require((published or port != 51736) and ports.get("5000/tcp") == [{"HostIp": "127.0.0.1", "HostPort": str(port)}],
            "Current candidate does not use this attempt's expected loopback port")
    config_files = (current["Config"].get("Labels") or {}).get("com.docker.compose.project.config_files", "")
    require(config_files == str(attempt / ("compose.public.json" if published else "compose.private.json")),
            "Running candidate belongs to another cutover attempt")


def load_hold(attempt, *, allow_inactive=False, allow_published=False):
    assert_isolated(attempt, [DATA])
    require_path(attempt)
    require(attempt.stat().st_mode & 0o077 == 0, "Cutover attempt directory must be private")
    held = json.loads((attempt / "hold.json").read_text())
    promoted = (attempt / "promoted.json").exists()
    require((allow_published or not promoted) and not (attempt / "code-rollback.json").exists(), "This cutover attempt already finished")
    for name, expected in held["sha256"].items():
        require(digest(attempt / name) == expected, "Captured cutover configuration/snapshot checksum changed")
    ids = command(["docker", "container", "ls", "--all", "--filter", "name=^/" + CONTAINER + "$", "--format", "{{.ID}}"])
    current = inspect("container", CONTAINER) if ids.strip() else None
    require(current is not None or allow_inactive, "The held candidate is absent")
    public_identity = current and (current["Config"].get("Labels") or {}).get("com.docker.compose.project.config_files") == str(attempt / "compose.public.json")
    published = bool(promoted or public_identity)
    if published:
        require(allow_published, "Public candidate requires explicit rollback mode")
        record = json.loads((attempt / ("promoted.json" if promoted else "promotion-started.json")).read_text())
        require(record.get("attempt_dir") == str(attempt) and record.get("hold_sha256") == digest(attempt / "hold.json") and
                record.get("candidate_image") == held["candidate_image"] and record.get("candidate_sha") == held["candidate_sha"],
                "Publication record belongs to another cutover attempt")
    if current:
        validate_hold_container(held, current, attempt, allow_inactive=allow_inactive, published=published)
    if not published or current is None or not current["State"]["Running"]:
        require_port_free(51736)
    return held, current


def promote(args):
    require(args.manual_promotion_approved, "Manual promotion approval is required")
    attempt = args.attempt_dir
    held, current = load_hold(attempt)
    checks = json.loads((attempt / "private-operator-checks.json").read_text())
    require(checks.get("attempt_dir") == str(attempt) and checks.get("hold_sha256") == digest(attempt / "hold.json"),
            "Private acceptance belongs to another cutover attempt")
    require(checks.get("candidate_image") == held["candidate_image"] and checks.get("candidate_sha") == held["candidate_sha"] and
            bool(checks.get("operator")) and bool(checks.get("evidence")) and all(checks.get("checks", {}).get(name) is True for name in PRIVATE_CHECKS),
            "Private candidate acceptance checks are incomplete or refer to a different candidate")
    original = json.loads((attempt / "container.inspect.json").read_text())
    save(attempt / "promotion-started.json", {"attempt_dir": str(attempt), "hold_sha256": digest(attempt / "hold.json"),
         "candidate_image": held["candidate_image"], "candidate_sha": held["candidate_sha"]})

    def switch():
        # Sequential stop/recreate preserves the app's one-worker/one-replica contract.
        command(["docker", "stop", "--time", "30", current["Id"]])
        command(compose(attempt / "compose.public.json") + ["up", "-d", "--no-build", "--pull", "never", "--no-deps", "app"])
        require(inspect("container", CONTAINER)["Image"] == held["candidate_image"], "Published image differs from the private accepted image")
        wait_health(51736)
        save(attempt / "promoted.json", {"attempt_dir": str(attempt), "hold_sha256": digest(attempt / "hold.json"),
             "candidate_image": held["candidate_image"], "candidate_sha": held["candidate_sha"],
             "private_acceptance_sha256": digest(attempt / "private-operator-checks.json"), "promoted_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})

    guarded_switch(lambda: None, switch, lambda: restore_original(attempt, original, held["candidate_image"]))
    print("Accepted candidate promoted on loopback51736. Record the public HTTPS/Socket.IO smoke and release evidence.", flush=True)


def rollback(args):
    require(args.manual_rollback_approved, "Explicit rollback approval is required")
    held, _ = load_hold(args.attempt_dir, allow_inactive=True, allow_published=True)
    original = json.loads((args.attempt_dir / "container.inspect.json").read_text())
    restore_original(args.attempt_dir, original, held["candidate_image"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    prep = sub.add_parser("prepare", help="Archive, briefly stop app for paired snapshot, restart app, restore two private staging stacks")
    prep.add_argument("--release-dir", type=Path, required=True)
    prep.add_argument("--expected-production-image", required=True)
    prep.add_argument("--candidate-image", required=True)
    prep.add_argument("--candidate-sha", required=True)
    prep.add_argument("--production-sha", required=True)
    prep.add_argument("--production-sha-evidence", type=Path, required=True)
    prep.add_argument("--staging-port", type=int, default=51737)
    prep.add_argument("--rollback-port", type=int, default=51738)
    prep.add_argument("--confirm-exclusive-app-writer", action="store_true")
    cutover = sub.add_parser("deploy", help="Stop public app, final paired snapshot, and hold candidate privately for acceptance")
    cutover.add_argument("--release-dir", type=Path, required=True)
    cutover.add_argument("--candidate-compose", type=Path, default=Path(__file__).resolve().parents[2] / "docker-compose.prod.yml")
    cutover.add_argument("--manual-cutover-approved", action="store_true")
    cutover.add_argument("--confirm-exclusive-app-writer", action="store_true")
    cutover.add_argument("--private-port", type=int, default=51739)
    publish = sub.add_parser("promote", help="Publish the exact privately accepted candidate; restore old image/config if publication fails")
    publish.add_argument("--attempt-dir", type=Path, required=True)
    publish.add_argument("--manual-promotion-approved", action="store_true")
    revert = sub.add_parser("rollback", help="Restore this attempt's exact original image/config from its held or published candidate")
    revert.add_argument("--attempt-dir", type=Path, required=True)
    revert.add_argument("--manual-rollback-approved", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        require(sys.platform == "linux" and os.geteuid() in (0, 1000), "Release operations require Linux and the reviewed UID1000 with Docker access (or root)")
        def interrupted(_number, _frame):
            raise ReleaseError("Release interrupted; inspect this attempt's private state and keep ingress restricted")
        signal.signal(signal.SIGTERM, interrupted)
        import fcntl
        # Root and the reviewed UID1000 must contend for the same host lock.
        require_path(DATA)
        descriptor = os.open(DATA / ".release.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        if os.geteuid() == 0:
            os.fchown(descriptor, 1000, 1000)
        with os.fdopen(descriptor, "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ReleaseError("Another release operation holds the host lock") from None
            {"prepare": prepare, "deploy": deploy, "promote": promote, "rollback": rollback}[args.operation](args)
    except (ReleaseError, OSError, ValueError, KeyError) as error:
        # OSError/JSON errors can include secret file contents/paths: expose only our fixed messages.
        print(str(error) if isinstance(error, ReleaseError) else "Host operation failed; release remains gated. Inspect private host files.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
