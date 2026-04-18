#!/usr/bin/env python3
"""Example host-side Telegram voice/audio sender.

This is intentionally a host template. It is not auto-installed and not wired
into the public skill by default.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--chat-id", default=os.environ.get("OPENCLAW_TG_CHAT_ID", ""))
    parser.add_argument("--bot-token", default=os.environ.get("OPENCLAW_TG_BOT_TOKEN", ""))
    parser.add_argument("--caption", default="")
    parser.add_argument("--as-voice", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    media_path = Path(args.file).expanduser().resolve()
    if not media_path.exists():
        print(json.dumps({"ok": False, "error": f"file not found: {media_path}"}, ensure_ascii=False))
        return 1
    if not args.chat_id or not args.bot_token:
        print(json.dumps({
            "ok": False,
            "error": "missing chat-id or bot-token",
            "hint": "Set OPENCLAW_TG_CHAT_ID and OPENCLAW_TG_BOT_TOKEN or pass --chat-id/--bot-token.",
        }, ensure_ascii=False))
        return 1

    endpoint = "sendVoice" if args.as_voice else "sendAudio"
    url = f"https://api.telegram.org/bot{args.bot_token}/{endpoint}"
    payload = {"chat_id": args.chat_id, "caption": args.caption}

    if args.dry_run:
        print(json.dumps({
            "ok": True,
            "dry_run": True,
            "endpoint": endpoint,
            "url": url,
            "payload": payload,
            "file": str(media_path),
        }, ensure_ascii=False, indent=2))
        return 0

    field_name = "voice" if args.as_voice else "audio"
    with media_path.open("rb") as fh:
        response = requests.post(url, data=payload, files={field_name: fh}, timeout=60)
    print(json.dumps(response.json(), ensure_ascii=False, indent=2))
    return 0 if response.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
