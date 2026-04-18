# Host Voice Integration

This document describes how to attach voice/TTS to the skill without making the
portable skill package depend on a specific model provider or channel.

## Principle

The public skill owns:

- what to say
- when a follow-up should happen
- continuity / event / hook logic

The host owns:

- which TTS engine to use
- whether the current model/provider supports audio output
- how the rendered file is sent to the selected channel adapter

Voice is therefore a **host addon**, not a mandatory skill-core feature.

## Recommended chain

1. skill decides there should be a follow-up
2. host receives final frontstage-safe text
3. host decides whether to keep text or render voice
4. host renders audio with the selected provider
5. host sends the resulting media through the target channel adapter

## Why this is host-side

Different models/providers support different things:

- some support native audio output
- some support text only
- some need a separate TTS API
- some channels want `voice`
- some want `audio`
- some want a file upload or media URL

Because of that, the public skill should expose a clean handoff point instead
of hard-binding to one TTS vendor.

## Recommended integration contract

When the host wants voice, use a small contract object like:

```json
{
  "text": "The final frontstage-safe message",
  "voice_id": "optional-host-voice-name",
  "model": "optional-provider-model-name",
  "output_format": "ogg",
  "channel": "direct",
  "target_to": "chat-or-recipient-id",
  "dispatch_mode": "voice"
}
```

The public skill does not need to know how that payload is executed.
The host script/addon should turn it into provider-specific calls.

## Fallback rule

If the host cannot render voice for the current provider/model/channel, fall
back to text instead of blocking the follow-up lifecycle.

Good fallback order:

1. try voice pipeline
2. if provider/model unsupported, send text
3. if channel rejects voice upload, send text

## Included template

This package includes an optional host template:

- `addons/host-voice-send-template/`

It provides:

- a generic TTS render wrapper template
- a generic channel voice send template example
- documentation for adapting the same pattern to other channels

## What the template is for

It is for hosts that want to connect:

- MiniMax or another external TTS API
- OpenAI/native audio output
- local/offline TTS
- channel-specific send logic

without changing the portable skill core.

## What the template does not claim

- it does not make every model support audio
- it does not guarantee every channel accepts the same file type
- it does not auto-install into live hosts

It is a host/operator integration helper only.
