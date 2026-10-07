"""Validate and summarize Issue #115 full-app raw A/B CSVs (Python stdlib only)."""

import csv
import statistics
import sys
from pathlib import Path


METRICS = (
    "host_cpu_percent",
    "host_available_ram_bytes",
    "app_working_set_bytes",
    "wsl_vm_working_set_bytes",
    "wsl_latency_ms",
    "companion_latency_ms",
)
PHASES = ("OFF_BEFORE", "ON", "OFF_AFTER")


def median(rows, metric):
    return statistics.median(float(row[metric]) for row in rows)


def load(path):
    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    label = path.name.removesuffix("-raw.csv")
    assert len(rows) == 72, f"{path}: expected 72 rows, got {len(rows)}"
    assert {row["build"] for row in rows} == {label}
    assert len({row["commit"] for row in rows}) == 1
    assert all(row["wsl_exit_code"] == "0" and row["companion_ok"] == "True" for row in rows)
    for trial in range(1, 4):
        for phase in PHASES:
            segment = [row for row in rows if row["trial"] == str(trial) and row["phase"] == phase]
            assert len(segment) == 8, (path, trial, phase, len(segment))
            assert sorted(int(row["sample"]) for row in segment) == list(range(1, 9))
            if phase == "ON":
                assert all(int(row["app_process_count"]) > 0 for row in segment)
            else:
                assert all(int(row["app_process_count"]) == 0 for row in segment)
    return rows


def summarize(rows, label):
    print(f"{label}: {rows[0]['commit']} ({len(rows)} raw samples)")
    print("metric | OFF stable median | ON stable median | ON minus OFF | trial deltas")
    for metric in METRICS:
        deltas = []
        off_values = []
        on_values = []
        for trial in range(1, 4):
            stable = lambda phase: [row for row in rows if row["trial"] == str(trial)
                                    and row["phase"] == phase and int(row["sample"]) > 1]
            off = stable("OFF_BEFORE") + stable("OFF_AFTER")
            on = stable("ON")
            off_values.extend(off)
            on_values.extend(on)
            deltas.append(median(on, metric) - median(off, metric))
        print(f"{metric} | {median(off_values, metric):.3f} | {median(on_values, metric):.3f} | "
              f"{statistics.median(deltas):+.3f} | {', '.join(f'{d:+.3f}' for d in deltas)}")
    app_cpu = [float(row["app_cpu_percent_of_one_core"]) for row in rows
               if row["phase"] == "ON" and int(row["sample"]) > 1]
    print(f"app_cpu_percent_of_one_core | ON median {statistics.median(app_cpu):.3f} | "
          f"ON max {max(app_cpu):.3f}")
    print()


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    for name in ("base", "head"):
        summarize(load(directory / f"{name}-raw.csv"), name)
