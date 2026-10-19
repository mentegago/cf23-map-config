#!/usr/bin/env python3
"""Generate sparse walking distances between booths from data/map.json."""

from __future__ import annotations

from collections import defaultdict, deque
import hashlib
import json
import math
from pathlib import Path
import re


SCHEMA_VERSION = 1
MAX_DISTANCE = 32
MAX_NEIGHBORS = 48
BOOTH_PATTERN = re.compile(
    r"^(?:([A-Z]+)-)?0*(\d+)([a-z]?)$",
    re.IGNORECASE,
)
DIRECTIONS = ((-1, 0), (1, 0), (0, -1), (0, 1))
SEMANTIC_DISTANCE_UNIT = 15.0


def canonical_booth(value: object) -> str | None:
    match = BOOTH_PATTERN.fullmatch(str(value).strip())
    if match is None:
        return None
    section, number, suffix = match.groups()
    canonical = f"{int(number)}{suffix.lower()}"
    return f"{section.upper()}-{canonical}" if section else canonical


def is_empty(grid: list[list[object]], row: int, col: int) -> bool:
    return (
        0 <= row < len(grid)
        and 0 <= col < len(grid[row])
        and not str(grid[row][col]).strip()
    )


def booth_access_points(
    grid: list[list[object]],
    cells: set[tuple[int, int]],
) -> set[tuple[int, int]]:
    access_points: set[tuple[int, int]] = set()
    for row, col in cells:
        for row_delta, col_delta in DIRECTIONS:
            adjacent_row = row + row_delta
            adjacent_col = col + col_delta
            if is_empty(grid, adjacent_row, adjacent_col):
                access_points.add((adjacent_row, adjacent_col))
                continue

            if not (
                0 <= adjacent_row < len(grid)
                and 0 <= adjacent_col < len(grid[adjacent_row])
            ):
                continue
            adjacent = str(grid[adjacent_row][adjacent_col]).strip()
            if adjacent not in {"a", "b"}:
                continue

            aisle_row = adjacent_row + row_delta
            aisle_col = adjacent_col + col_delta
            if is_empty(grid, aisle_row, aisle_col):
                access_points.add((aisle_row, aisle_col))
    return access_points


def distances_from(
    grid: list[list[object]],
    source: str,
    source_access: set[tuple[int, int]],
    booths_by_access: dict[tuple[int, int], set[str]],
) -> dict[str, int]:
    queue = deque((row, col, 0) for row, col in source_access)
    visited = set(source_access)
    distances: dict[str, int] = {}

    while queue:
        row, col, distance = queue.popleft()
        for booth in booths_by_access.get((row, col), ()):
            if booth != source:
                previous = distances.get(booth)
                if previous is None or distance < previous:
                    distances[booth] = distance

        if distance >= MAX_DISTANCE:
            continue
        next_distance = distance + 1
        for row_delta, col_delta in DIRECTIONS:
            next_row = row + row_delta
            next_col = col + col_delta
            position = (next_row, next_col)
            if position in visited or not is_empty(grid, next_row, next_col):
                continue
            visited.add(position)
            queue.append((next_row, next_col, next_distance))

    return distances


def encoded_map_bytes(document: object) -> bytes:
    return json.dumps(
        document,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def generate_grid(grid: list[list[object]], map_sha256: str) -> dict[str, object]:
    cells_by_booth: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for row, values in enumerate(grid):
        for col, value in enumerate(values):
            booth = canonical_booth(value)
            if booth is not None:
                cells_by_booth[booth].add((row, col))

    access_by_booth = {
        booth: booth_access_points(grid, cells)
        for booth, cells in cells_by_booth.items()
    }
    inaccessible = sorted(
        booth for booth, access in access_by_booth.items() if not access
    )
    if inaccessible:
        preview = ", ".join(inaccessible[:10])
        raise RuntimeError(
            f"{len(inaccessible)} booths have no aisle access points: {preview}"
        )

    booths_by_access: dict[tuple[int, int], set[str]] = defaultdict(set)
    for booth, access_points in access_by_booth.items():
        for position in access_points:
            booths_by_access[position].add(booth)

    booths = sorted(cells_by_booth)
    booth_indices = {booth: index for index, booth in enumerate(booths)}
    neighbors: list[list[list[int]]] = []
    for booth in booths:
        distances = distances_from(
            grid,
            booth,
            access_by_booth[booth],
            booths_by_access,
        )
        ordered = sorted(
            distances.items(), key=lambda item: (item[1], item[0])
        )[:MAX_NEIGHBORS]
        neighbors.append(
            [[booth_indices[target], distance] for target, distance in ordered]
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "map_sha256": map_sha256,
        "max_distance": MAX_DISTANCE,
        "max_neighbors": MAX_NEIGHBORS,
        "booths": booths,
        "neighbors": neighbors,
    }


def generate_semantic(
    document: dict[str, object], map_sha256: str
) -> dict[str, object]:
    positions: dict[str, tuple[float, float]] = {}
    features = document.get("features")
    if not isinstance(features, list):
        raise RuntimeError("Semantic map does not contain a features list")

    for feature in features:
        if (
            not isinstance(feature, dict)
            or feature.get("kind") != "booth"
            or feature.get("status") == "suggestion"
        ):
            continue
        booth = canonical_booth(feature.get("id", ""))
        geometry = feature.get("geometry")
        if booth is None or not isinstance(geometry, dict):
            continue
        try:
            x = float(geometry["x"])
            y = float(geometry["y"])
            width = float(geometry["width"])
            height = float(geometry["height"])
        except (KeyError, TypeError, ValueError):
            continue
        if width <= 0 or height <= 0:
            continue
        if booth in positions:
            raise RuntimeError(f"Duplicate booth ID in semantic map: {booth}")
        positions[booth] = (x + width / 2, y + height / 2)

    booths = sorted(positions)
    booth_indices = {booth: index for index, booth in enumerate(booths)}
    neighbors: list[list[list[int]]] = []
    for source in booths:
        source_x, source_y = positions[source]
        distances: list[tuple[str, int]] = []
        for target in booths:
            if source == target:
                continue
            target_x, target_y = positions[target]
            pixels = math.hypot(target_x - source_x, target_y - source_y)
            distance = max(1, round(pixels / SEMANTIC_DISTANCE_UNIT))
            if distance <= MAX_DISTANCE:
                distances.append((target, distance))
        ordered = sorted(distances, key=lambda item: (item[1], item[0]))[
            :MAX_NEIGHBORS
        ]
        neighbors.append(
            [[booth_indices[target], distance] for target, distance in ordered]
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "map_sha256": map_sha256,
        "max_distance": MAX_DISTANCE,
        "max_neighbors": MAX_NEIGHBORS,
        "booths": booths,
        "neighbors": neighbors,
    }


def generate(map_path: Path) -> dict[str, object]:
    document = json.loads(map_path.read_bytes())
    map_sha256 = hashlib.sha256(encoded_map_bytes(document)).hexdigest()
    if isinstance(document, dict) and isinstance(document.get("features"), list):
        if document.get('schemaVersion') != 2:
            raise RuntimeError('Unsupported semantic map schema')
        bounds = document.get('bounds', {})
        if not isinstance(bounds, dict) or any(
            not isinstance(bounds.get(axis), (int, float))
            or not math.isfinite(bounds[axis]) or bounds[axis] <= 0
            for axis in ('width', 'height')
        ):
            raise RuntimeError('Invalid map bounds')
        if not document['features']:
            raise RuntimeError('Empty map features')
        return generate_semantic(document, map_sha256)
    if isinstance(document, list):
        if not document or not isinstance(document[0], list) or not document[0] or any(
            not isinstance(row, list) or len(row) != len(document[0]) for row in document
        ):
            raise RuntimeError('Map grid must be nonempty and rectangular')
        return generate_grid(document, map_sha256)
    raise RuntimeError("Unsupported map JSON format")
