# Notes for Claude

- Single-user personal tool. UI language: Russian.
- The user lives in Kyiv: default time zone `Europe/Kyiv` for anything date-related.
- Work is done in stages; one branch per stage, stacked: `stage-N-<name>`.
- Everything must work with `PROVIDER_MODE=mock` (no network). Real adapters follow official provider docs only; unknowns are marked `TODO`.
- Never commit secrets; never log API keys.
- Checks before commit: `npm run lint && npm test && npm run build`.
