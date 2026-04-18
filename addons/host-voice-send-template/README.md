# Host Voice Send Template

This addon is an **optional host template** for turning final skill text into
voice/audio delivery.

It is not part of the portable skill core.

Default GitHub ZIP / release ZIP / ClawHub install:

- installs the skill package only
- does **not** auto-apply this addon

Use this addon when a host wants to:

1. render TTS with a provider chosen by the host
2. send the resulting media through a channel adapter

## Included

- `scripts/render_tts_template.py`
  - generic wrapper that prepares a provider-neutral TTS contract
  - can optionally delegate to a real host command through environment vars
- `scripts/send_telegram_voice_template.py`
  - example Telegram `sendVoice` / `sendAudio` sender
  - can be adapted to Discord / LINE / WhatsApp / other host adapters
- `requirements.txt`
  - optional addon-only Python dependency list for the Telegram sender template

Install the optional addon dependency only if you use the Telegram sender:

```bash
python3 -m pip install -r addons/host-voice-send-template/requirements.txt
```

## Expected use

1. take final frontstage-safe text from the skill
2. render audio with the host-selected provider/model/voice
3. send the output file through the host's channel adapter
4. fall back to text if the provider/channel does not support the request

## Secret handling

If you adapt the Telegram sender template, prefer environment variables such
as:

- `OPENCLAW_TG_BOT_TOKEN`
- `OPENCLAW_TG_CHAT_ID`

The template also accepts `--bot-token` and `--chat-id` for debugging, but
environment variables are safer for public/operator use because command-line
arguments may appear in shell history or process listings.

## Important

This addon is a template, not a universal media backend.

Different providers differ on:

- whether they support TTS at all
- how they select voices
- whether they return `mp3`, `wav`, `ogg`, or another format
- whether the target channel prefers `voice` vs `audio`

That is why this ships as a host template instead of a hard-coded public skill
dependency.
