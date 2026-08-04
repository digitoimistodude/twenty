# Twenty → Slack #myynti relay

Posts curated Twenty CRM events to Slack #myynti. Twenty webhook → nginx (public,
signature-verified path) → this relay (localhost:8787) → Slack incoming webhook.

Why a relay: Twenty's webhook client blocks internal IPs (SSRF guard), so it can't hit
localhost directly - it reaches us via `https://crm.dude.fi/hooks/<secret-path>` which
nginx proxies back to 127.0.0.1:8787. The relay also verifies Twenty's HMAC signature
and formats readable Slack messages.

## Files / services
- `server.mjs` - the relay (Node, no deps). systemd: `twenty-slack-relay`.
- `config.mjs` - **which events post and how they read**. Edit this to decide what to send.
- `.env` - `RELAY_PORT`, `TWENTY_WEBHOOK_SECRET`, `SLACK_WEBHOOK_URL`, `TWENTY_BASE_URL`.
- `nginx-path.txt` - the secret URL path segment.
- nginx: `location = /hooks/<path>` in `/etc/nginx/sites-available/crm.dude.fi`.
- Twenty webhook: created via metadata API, `operations` = the curated list, `secret` = `TWENTY_WEBHOOK_SECRET`.

## Decide what to send
Edit `config.mjs` (toggle `enabled`, tweak `format`, add rules), then:
`sudo systemctl restart twenty-slack-relay`. To add a new event type you must also add
its `<object>.<operation>` to the Twenty webhook's `operations` (update via metadata API).

## Activate / change the Slack channel
Set `SLACK_WEBHOOK_URL` in `.env` to the #myynti incoming webhook, then restart. Empty =
dry-run (formats + logs, posts nothing). Check: `journalctl -u twenty-slack-relay -f`.

## Upgrade notes
Relay + nginx location live outside Twenty (upgrade-safe). The Twenty webhook is a row in
`core.webhook` (survives same-DB upgrades). No Twenty source changes.
