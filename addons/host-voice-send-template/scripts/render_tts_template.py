#!/usr/bin/env python3
"""Template wrapper for host-side TTS rendering.

This script is intentionally generic. It builds a normalized request payload and
can optionally delegate to a real provider command through environment vars.

Typical host flow:
1. skill produces final frontstage-safe text
2. host calls this script (or its adapted copy)
3. script prepares a provider-neutral payload
4. host-specific command performs the actual render
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def build_payload(args: argparse.Namespace) -> dict:
    return {
        "text": args.text,
        "voice_id": args.voice_id,
        "model": args.model,
        "output_format": args.output_format,
        "output_path": str(Path(args.output).expanduser().resolve()),
        "provider": args.provider,
        "metadata": {
            "channel": args.channel,
            "target_to": args.target_to,
            "dispatch_mode": args.dispatch_mode,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice-id", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--provider", default="host-tts")
    parser.add_argument("--output-format", default="ogg")
    parser.add_argument("--channel", default="")
    parser.add_argument("--target-to", default="")
    parser.add_argument("--dispatch-mode", default="voice")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    payload = build_payload(args)
    render_cmd = os.environ.get("HOST_TTS_RENDER_CMD", "").strip()

    if args.dry_run or not render_cmd:
        print(json.dumps({
            "mode": "template",
            "executed": False,
            "payload": payload,
            "note": "Set HOST_TTS_RENDER_CMD to a real renderer command to enable actual TTS output.",
        }, ensure_ascii=False, indent=2))
        return 0

    proc = subprocess.run(
        shlex.split(render_cmd),
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        return proc.returncode
    if proc.stdout.strip():
        print(proc.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
