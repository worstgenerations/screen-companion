# Roadmap

Source spec: MELO AI — Transform into a fast, real-time AI assistant (uploaded 2026-11-03).

- [ ] 1. Make Melo completely free — remove entitlement/trial/limit gates from melo-stream + legacy meloAsk; strip pricing/trial/billing UI from landing, dashboard, auth; keep auth + usage logging + admin.
- [ ] 2. Guide mode — system prompt: one step at a time, wait/continue, adapt instantly.
- [ ] 3. Quick actions on the Melo home screen (Ask, Share Screen & Talk, Talk, Explain This Page, Help Me Fix Something, Teach Me, Continue Previous Task).
- [ ] 4. Internal diagnostics (dev-only debug panel): STT/TTS latency, TTFT, total, capture, failed/cancelled counts.
- [ ] 5. Chrome extension (MV3, side panel) in melo-extension/: sign-in, chat, mic, TTS, current-tab screenshot via existing backend; CORS on /api/melo-stream + /api/speak.
- [ ] 6. Verify: tsgo clean, build OK, browser test of free access + quick actions.
