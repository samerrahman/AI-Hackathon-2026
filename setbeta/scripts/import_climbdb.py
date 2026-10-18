#!/usr/bin/env python3
"""Read a local ClimbDB climbing_data.csv and print descriptive aggregates.

No CSV, names, video URLs, or attempt rows are copied into this project.
Usage: python3 scripts/import_climbdb.py /path/to/climbing_data.csv
"""

import argparse
import csv
from collections import defaultdict
from pathlib import Path

REQUIRED = {
    "grade", "climbing_time", "right_hand_moves", "left_hand_moves",
    "right_leg_moves", "left_leg_moves", "total_num_moves", "success",
}
MOVE_FIELDS = ("right_hand_moves", "left_hand_moves", "right_leg_moves", "left_leg_moves")


def read_attempts(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")
        for line, row in enumerate(reader, start=2):
            try:
                grade = row["grade"].strip().upper()
                if not grade.startswith("V") or not grade[1:].isdigit():
                    raise ValueError("invalid grade")
                moves = [int(row[field]) for field in MOVE_FIELDS]
                total = int(row["total_num_moves"])
                if min(*moves, total) < 0 or total != sum(moves):
                    raise ValueError("movement counts are negative or disagree with total")
                minutes, seconds = map(int, row["climbing_time"].strip().split(":"))
                if minutes < 0 or not 0 <= seconds < 60:
                    raise ValueError("invalid climbing_time")
                success = row["success"].strip().upper()
                if success not in {"TRUE", "FALSE"}:
                    raise ValueError("invalid success value")
            except (TypeError, ValueError, AttributeError) as exc:
                raise ValueError(f"Invalid attempt at CSV line {line}: {exc}") from exc
            yield grade, moves[0] + moves[1], moves[2] + moves[3], total, minutes * 60 + seconds, success == "TRUE"


def summarize(path: Path):
    groups = defaultdict(list)
    for attempt in read_attempts(path):
        groups[attempt[0]].append(attempt)
    if not groups:
        raise ValueError("CSV contains no attempts")
    return groups


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="Local ClimbDB climbing_data.csv")
    args = parser.parse_args()
    try:
        groups = summarize(args.csv_path)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print("ClimbDB descriptive attempt comparison (observed during/after climbs; no route generation or prediction)")
    print("| Grade | Attempts (n) | Mean hand moves | Mean leg moves | Mean total moves | Mean time (s) | Completed (n) |")
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for grade in sorted(groups, key=lambda g: int(g[1:])):
        rows = groups[grade]
        n = len(rows)
        print(f"| {grade} | {n} | {sum(r[1] for r in rows)/n:.1f} | {sum(r[2] for r in rows)/n:.1f} | {sum(r[3] for r in rows)/n:.1f} | {sum(r[4] for r in rows)/n:.1f} | {sum(r[5] for r in rows)} |")
    print(f"Total attempts: {sum(map(len, groups.values()))}. Counts include incomplete attempts.")


if __name__ == "__main__":
    main()
