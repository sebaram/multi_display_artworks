"""Retire only identified, incomplete isolated staging resources; retain every data file."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

from inventory import DATA, MEDIA, ReleaseError, command, inspect

IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
SNAPSHOT_FILES = {"mongo.archive.gz", "media.tar", "collections.json"}


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def checked_path(path, *, file=False, private=False):
    require(path.is_absolute() and path.resolve() == path and not path.is_symlink() and
            all(not parent.is_symlink() for parent in path.parents), "Retirement path is not canonical or traverses a symlink")
    require(path.is_file() if file else path.is_dir(), "Required retirement path is missing or has the wrong type")
    if private:
        metadata = path.stat()
        require(metadata.st_uid == 1000 and metadata.st_mode & 0o077 == 0, "Retirement evidence must be private and owned by UID1000")


def isolated(path, live_paths):
    resolved = path.resolve()
    for live in live_paths:
        live = Path(live).resolve()
        require(resolved != live and resolved not in live.parents and live not in resolved.parents,
                "Staging retirement path overlaps production data")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def evidence(path):
    checked_path(path, file=True, private=True)
    return json.loads(path.read_text())


def listed(kind, filter_value):
    args = ["docker", kind, "ls"] + (["--all"] if kind == "container" else [])
    ids = command(args + ["--filter", filter_value, "--format", "{{.ID}}"] ).decode().split()
    require(all(re.fullmatch(r"[0-9a-f]{12,64}", value) for value in ids), "Unexpected Docker identifier in retirement inventory")
    return [inspect(kind, identifier) for identifier in ids]


def named(kind, name):
    rows = listed(kind, "name=^" + ("/" if kind == "container" else "") + name + "$")
    require(len(rows) <= 1 and all(row["Name"].lstrip("/") == name for row in rows), "Exact staging resource lookup is ambiguous")
    return rows[0] if rows else None


def validate_mounts(container, stage, role, kind, live_paths):
    if kind == "mongo":
        expected = {"/data/db": stage / "mongo", "/data/configdb": stage / "mongo-configdb"}
    else:
        expected = {destination: stage / "media" / name for name, destination in MEDIA.items()}
        if role == "legacy" and len(container["Mounts"]) == len(MEDIA) - 1:
            expected.pop(MEDIA["wall_media"])
    mounts = container["Mounts"]
    require(len(mounts) == len(expected) and {mount["Destination"] for mount in mounts} == set(expected),
            "Staging container has unrecognized or missing mounts")
    for mount in mounts:
        destination = mount["Destination"]
        source = Path(mount["Source"])
        require(mount["Type"] == "bind" and source == expected[destination], "Staging mount is not the exact isolated bind")
        checked_path(source, file=destination.endswith(".glb"))
        isolated(source, live_paths)


def preflight(directory, candidate_sha):
    require(SHA.fullmatch(candidate_sha) is not None, "Retirement requires the full candidate source SHA")
    root = Path.home() / ".local/state/metamuseum/releases"
    require(directory.parent == root and re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", directory.name),
            "Retirement must select one release directly inside this user's private release state")
    for path in (root.parent, root, directory, directory / "snapshot"):
        checked_path(path, private=True)
    require(not (directory / "prepared.json").exists() and not (directory / "prepared.json").is_symlink(),
            "Prepared releases cannot be retired by the incomplete-staging helper")
    original = evidence(directory / "container.inspect.json")
    mongo = evidence(directory / "mongo.inspect.json")
    require(IMAGE.fullmatch(original["Image"]) is not None and IMAGE.fullmatch(mongo["Image"]) is not None and
            IDENTIFIER.fullmatch(original["Id"]) is not None and IDENTIFIER.fullmatch(mongo["Id"]) is not None,
            "Captured production image/container provenance is invalid")
    live_paths = [DATA] + [mount["Source"] for record in (original, mongo) for mount in record.get("Mounts", []) if mount.get("Source")]
    isolated(directory, live_paths)
    paired = evidence(directory / "snapshot/snapshot.json")
    require(paired.get("production_image") == original["Image"] and paired.get("container_id") == original["Id"] and
            set(paired["sha256"]) == SNAPSHOT_FILES, "Paired snapshot provenance or file list is invalid")
    for name, expected in paired["sha256"].items():
        path = directory / "snapshot" / name
        checked_path(path, file=True, private=True)
        require(re.fullmatch(r"[0-9a-f]{64}", expected) is not None and digest(path) == expected,
                "Paired snapshot checksum does not match; retirement refused")

    token = hashlib.sha256(str(directory).encode()).hexdigest()[:12]
    expected_networks = {"metamuseum-release-" + token + "-" + role for role in ("candidate", "legacy")}
    expected_containers = {network + "-" + kind for network in expected_networks for kind in ("app", "mongo")}
    labelled_containers = listed("container", "label=metamuseum.release=" + token)
    labelled_networks = listed("network", "label=metamuseum.release=" + token)
    require(all(item["Name"].lstrip("/") in expected_containers for item in labelled_containers) and
            all(item["Name"] in expected_networks for item in labelled_networks), "Unrecognized resource carries this release's ownership label")
    containers, networks = [], []
    for role in ("candidate", "legacy"):
        name = "metamuseum-release-" + token + "-" + role
        network = named("network", name)
        stack = []
        for kind in ("app", "mongo"):
            container = named("container", name + "-" + kind)
            if container is None:
                continue
            require(IDENTIFIER.fullmatch(container["Id"]) is not None and container["Id"] not in (original["Id"], mongo["Id"]),
                    "Staging container identity overlaps captured production")
            require((container["Config"].get("Labels") or {}).get("metamuseum.release") == token,
                    "Staging container ownership label is absent or wrong")
            connections = container["NetworkSettings"]["Networks"]
            require(set(connections) == {name}, "Staging container is attached to another network")
            if network:
                require(connections[name].get("NetworkID") == network["Id"], "Staging network identity changed")
            require(IMAGE.fullmatch(container["Image"]) is not None, "Staging container image is not immutable")
            if kind == "mongo":
                require(container["Image"] == mongo["Image"], "Staging Mongo image differs from captured production")
            elif role == "candidate":
                image = inspect("image", container["Image"])
                require(image["Id"] == container["Image"] and (image["Config"].get("Labels") or {}).get("org.opencontainers.image.revision") == candidate_sha,
                        "Staging candidate image does not match the explicit source SHA")
            else:
                require(container["Image"] == original["Image"], "Legacy staging image differs from the captured original")
            validate_mounts(container, directory / ("staging-" + role), role, kind, live_paths)
            stack.append(container)
        if network:
            require(IDENTIFIER.fullmatch(network["Id"]) is not None and network.get("Internal") is True and network.get("Driver") == "bridge" and
                    (network.get("Labels") or {}).get("metamuseum.release") == token, "Staging network ownership or isolation is invalid")
            members = network.get("Containers") or {}
            known = {item["Id"]: item["Name"].lstrip("/") for item in stack}
            require(set(members) <= set(known) and all(item["Name"] == known[identifier] for identifier, item in members.items()),
                    "Staging network has an unrecognized endpoint")
            networks.append(network)
        containers.extend(stack)
    require({item["Id"] for item in containers} == {item["Id"] for item in labelled_containers} and
            {item["Id"] for item in networks} == {item["Id"] for item in labelled_networks}, "Staging ownership inventory changed during validation")
    return token, containers, networks


def retire(directory, candidate_sha, operator):
    require(bool(re.fullmatch(r"[A-Za-z0-9_.@:+-]{1,128}", operator)), "Retirement operator identifier is required")
    token, containers, networks = preflight(directory, candidate_sha)
    # All stacks pass before the first mutation; immutable IDs prevent name-reuse races.
    for container in sorted(containers, key=lambda item: item["Name"].endswith("-mongo")):
        command(["docker", "container", "rm", "--force", container["Id"]])
    for network in networks:
        command(["docker", "network", "rm", network["Id"]])
    record = {"candidate_sha": candidate_sha, "operator": operator, "token": token,
              "containers_removed": len(containers), "networks_removed": len(networks), "data_deleted": False,
              "completed_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with (directory / ("retirement-" + str(time.time_ns()) + ".json")).open("x") as output:
        json.dump(record, output, sort_keys=True)
        output.write("\n")
    return {key: record[key] for key in ("containers_removed", "networks_removed", "data_deleted")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--operator", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        require(sys.platform == "linux" and os.geteuid() == 1000, "Retirement requires the reviewed Linux UID1000 with Docker access")
        import fcntl
        state = Path.home() / ".local/state/metamuseum"
        checked_path(state, private=True)
        checked_path(DATA)
        descriptor = os.open(DATA / ".release.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(retire(args.release_dir, args.candidate_sha, args.operator), sort_keys=True))
    except (ReleaseError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, ReleaseError) else "Retirement refused or incomplete; inspect private host state. Backups retained.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
