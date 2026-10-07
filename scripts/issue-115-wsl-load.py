"""Bounded load in the runner-owned Ubuntu distro for Issue #115 A/B."""

import hashlib
import multiprocessing
import os
import time
from pathlib import Path


ROOT = Path("/tmp/wslpad-issue-115-load")
READY = ROOT / "ready"
STOP = ROOT / "stop"
PROGRESS = ROOT / "progress"
DATA = Path.home() / "wslpad-issue-115-load" / "io.bin"


def cpu_worker():
    block = b"wslpad-issue-115" * 524288  # 8 MiB
    while not STOP.exists():
        hashlib.sha256(block).digest()


def main():
    ROOT.mkdir(exist_ok=True)
    DATA.parent.mkdir(exist_ok=True)
    for marker in (READY, STOP, PROGRESS):
        marker.unlink(missing_ok=True)
    # Commit 1 GiB of guest RAM, keeping it resident during the app's polling.
    memory = bytearray(1024 * 1024 * 1024)
    for offset in range(0, len(memory), 4096):
        memory[offset] = 1

    cpu = multiprocessing.Process(target=cpu_worker)
    cpu.start()
    READY.write_text("ready\n")
    block = bytes(range(256)) * 262144  # 64 MiB per file cycle
    cycles = 0
    try:
        while not STOP.exists():
            with DATA.open("wb") as output:
                output.write(block)
                output.flush()
                os.fsync(output.fileno())
            with DATA.open("rb") as source:
                while source.read(1024 * 1024):
                    pass
            DATA.unlink()
            cycles += 1
            PROGRESS.write_text(f"{cycles}\n")
            memory[cycles % len(memory)] = cycles % 256
    finally:
        STOP.touch()
        cpu.join(timeout=5)
        if cpu.is_alive():
            cpu.terminate()
            cpu.join(timeout=5)
        DATA.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
