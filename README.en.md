# chatgpt-webui

[简体中文](README.md) | **English**

Remotely use the original ChatGPT Desktop interface in your browser to manage Codex projects and conversations on the host machine.

This project reuses the installed app's HTML, JavaScript, CSS, and backend, adapting Electron communication through WebSocket.

> An unofficial, experimental project with no affiliation with OpenAI.

## Preview

![chatgpt-webui running the original interface](docs/images/screenshot.png)

## Features

- Use the original project sidebar, conversation list, and chat interface in a browser.
- Keep the original app backend and local Codex configuration, tools, and conversation storage.
- Browse folders on the **host machine** in a web dialog and add projects. Supports entering a path, navigating to the parent or home directory, and showing hidden folders.
- Forward standard IPC, worker messages, and App-host MessagePort communication to the browser.
- Choose randomly generated access tokens, a fixed token, or token-free access.
- Access the app through SSH forwarding or an Nginx HTTPS / WebSocket reverse proxy.
- Generate a disposable app copy with source-version and patch-checksum records, making it easier to reapply changes after upgrades.

## Browser operation adapters

- **Conversation attachments**: use the original **Add files** action to upload files from your device or select local files on the host machine.
- **Copy text/links**: the App-host text clipboard service uses the browser Clipboard API.
- **Context menus**: use the original frontend's web menus.
- **Save as / save a copy**: choose a download filename in a web dialog. The client download becomes available after the original App finishes writing. A visible download link remains if the browser blocks automatic downloads.

Static pages, scripts, and styles support Brotli/gzip compression. The browser keeps a private cache and validates it with ETags on each visit; unchanged resources return `304` without retransmitting their contents. Changes from adapter or App updates trigger a fresh download. Login, session APIs, uploads, staged downloads, and host files are not cached. Compression runs asynchronously on the first request, with results cached in process memory (up to 64 MiB) and regenerated after a restart. No additional Nginx compression setup is needed.

## Requirements

- Linux.
- ChatGPT Desktop: an existing installation can be reused. If none is found, the launcher asks before downloading it into the repository.
- Currently adapted package version: `chatgpt-desktop 26.930.21537-1`.
- Node.js 22+/npm and Python 3.11+: the launcher checks for them and asks before installing missing runtimes locally.
- At least 3 GiB of free space is recommended for the initial downloads. Basic bootstrap tools are a POSIX shell, curl or wget, tar, sha256sum, and Linux `ldd`.
- The host must provide Electron's native libraries, including glibc, GTK, and NSS. Missing libraries are checked before startup.

## Quick start

Download this repository and enter its directory:

```sh
scripts/start --ozone-platform=headless --disable-gpu
```

On first launch, the script checks Python, Node/npm, the app, native shared libraries, and project dependencies. Before a required download, it displays the source, version, and destination, then asks `Continue [y/N]`. Pressing Enter or entering `n` stops setup.

```sh
# Check the environment without downloading or starting the app
scripts/start --check

# Install dependencies and prepare the app copy without starting it
scripts/start --setup-only

# Explicitly approve all repository-local downloads for unattended setup
scripts/start --yes --setup-only
scripts/start --yes --ozone-platform=headless --disable-gpu
```

Use `--help` for launcher options; other arguments are passed through to Electron.

### Updating and rolling back Desktop

Stop the Web UI and run `scripts/update` (`scripts/update --yes` for unattended downloads). Run `scripts/rollback` to restore the version saved by the last successful update. The equivalent commands are `scripts/start update|rollback`, `npm run update:desktop -- --yes`, and `npm run rollback:desktop`. Unset `CHATGPT_APP_DIR` before using version management. Restart using your usual command and environment afterward; neither operation starts the App.

Updates resolve the latest release for the host architecture from the official stable package index, verify its SHA-256, and prepare the bridge and static assets in a staging directory before switching. Failures preserve the original runtime; the next start or `--setup-only` recovers an interrupted switch. An already-current installation retains its rollback history. Allow at least 6 GiB of free space.

The selection persists in `.deps/desktop-state.json`. The first update snapshots the old source, including a system installation, into `.deps/desktop-sources/`; later updates retain the version they replace. Rollback needs no App download and consumes the single saved rollback entry. Downloaded sources remain on disk. These commands preserve `.profile`; rollback does not reverse user-data migrations performed by a newer Desktop. Preparation checks compatibility, while actual browser behavior still needs validation after startup.

Automatic installation covers:

| Component | Source and version | Repository location |
| --- | --- | --- |
| ChatGPT Desktop | [Official Linux distribution](https://learn.chatgpt.com/docs/linux/linux-app); pinned to the adapted version `26.930.21537`, selecting the x64 / ARM64 build | `.deps/chatgpt-<version>-<architecture>/` |
| Node.js + npm | [nodejs.org](https://nodejs.org/dist/latest-v22.x/); resolves the current Node 22 LTS release at installation time | `.deps/node/` |
| Python | [Astral uv](https://docs.astral.sh/uv/guides/install-python/) downloads a Python 3.12 standalone build | `.deps/python/`, `.deps/uv/` |
| npm dependencies | `package-lock.json`, installed with `npm ci --ignore-scripts` | `node_modules/`, with cache in `.deps/cache/` |

The app's `.deb` is used **only to extract app files; no sudo is required**.

Open the login URL printed in the terminal, such as `http://127.0.0.1:18765/login?token=...`. The current URL is also saved in `.logs/access-url`.

The default listening address is `127.0.0.1:18765`. Press `Ctrl+C` to stop the service. Without the headless arguments, the app displays a local window, which can be used for initial sign-in:

```sh
scripts/start
```

After signing in, stop the windowed instance and start the headless version if desired.

### Three access-token modes

**Default: generate a random token on each start**

```sh
scripts/start --ozone-platform=headless --disable-gpu
```

After a restart, the old URL and cookies are invalid. Open the new URL from `.logs/access-url`.

**Use a fixed token**

```sh
export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'
scripts/start --ozone-platform=headless --disable-gpu
```

Use at least 16 characters. A random value generated with `openssl rand -hex 32` is recommended.

**Disable access-token authentication**

```sh
unset CHATGPT_WEB_ACCESS_TOKEN
CHATGPT_WEB_AUTH=none scripts/start --ozone-platform=headless --disable-gpu
```

Open `http://127.0.0.1:18765/` directly. Anyone who can reach the service can operate the host app in this mode. Use it only on a trusted local machine, through a private tunnel, or behind a reverse proxy with separate authentication. **Do not expose an unauthenticated endpoint directly to the public internet.**

### Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `CHATGPT_APP_DIR` | Auto-detected | Directory containing an installed or manually extracted app |
| `CHATGPT_WEB_PROXY` | Environment / desktop manual proxy | Shared download proxy; an empty value disables proxies |
| `CHATGPT_WEB_PYTHON` | System or local Python | Explicit path to the bootstrap Python interpreter |
| `CHATGPT_WEB_SETUP_YES` | `0` | Set to `1` to approve repository-local installation, equivalent to `--yes` |
| `CHATGPT_WEB_HOST` | `127.0.0.1`; container `0.0.0.0` | Server bind IP, independent of the browser-facing origin |
| `CHATGPT_WEB_PORT` | `18765` | Local listening port |
| `CHATGPT_WEB_AUTH` | `token` | `token` or `none` |
| `CHATGPT_WEB_ACCESS_TOKEN` | Randomly generated | Custom access token; do not combine with `none` |
| `CHATGPT_WEB_ORIGIN` | `http://127.0.0.1:<port>` | The actual browser-facing origin, such as `https://chatgpt.example.com` |

Examples of changing the app directory or port:

```sh
CHATGPT_APP_DIR=/path/to/chatgpt scripts/start --setup-only
CHATGPT_WEB_PORT=18766 scripts/start --ozone-platform=headless --disable-gpu
```

## Docker deployment

Install Docker Engine and the Compose plugin, then run from the repository directory:

```sh
docker compose up -d --build
docker compose logs -f chatgpt-webui
```

The first start automatically downloads the adapted App version; starting Compose approves these local downloads. The image includes only the adapter, Node/Python, and system dependencies, without the original App or account data. Linux amd64/arm64 are supported. Allow at least 3 GiB for data and wait for the initial download and runtime preparation to finish.

Retrieve the current login URL:

```sh
docker compose exec chatgpt-webui cat /app/.logs/access-url
```

The port is published only on the host's `127.0.0.1:18765` by default. Use the SSH tunnel or host Nginx template below for remote access. If the port is already occupied or you use an external domain, configure it before starting:

```sh
export CHATGPT_WEB_PUBLISH_PORT=18766
export CHATGPT_WEB_ORIGIN=http://127.0.0.1:18766
# For HTTPS reverse proxies, use the actual browser-facing origin:
# export CHATGPT_WEB_ORIGIN=https://chatgpt.example.com
docker compose up -d
```

For a fixed token, use `export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'`. For token-free access, run `unset CHATGPT_WEB_ACCESS_TOKEN` and `export CHATGPT_WEB_AUTH=none`, then `docker compose up -d`. Downloads accept `CHATGPT_WEB_PROXY` or standard proxy environment variables. Inside the container, `127.0.0.1` refers to the container itself; the proxy must be reachable from it. Build-time proxies use Docker's own daemon/build configuration.

If Docker's build network cannot reach package sources on Linux, build using the host network and then start the existing image:

```sh
docker build --network=host -t chatgpt-webui:local .
docker compose up -d --no-build
```

### Sign-in, projects, and persistence

The container is a separate execution environment. **It does not automatically read host credentials, Codex conversations, or files.** For Codex, use the bundled CLI's device authorization flow (your account must allow device authorization), then follow the terminal instructions in your client browser:

```sh
docker compose exec chatgpt-webui /app/.runtime/resources/codex login --device-auth
docker compose restart chatgpt-webui
```

This authenticates Codex. Other desktop App account features may still require separate sign-in; browser sign-in interactions require manual acceptance. Do not let the host and container write to the same Codex data directory concurrently.

- The `data` volume stores downloaded App files, the runtime copy, Electron profile, Codex configuration/conversations, attachments, staged downloads, and logs. It is mounted at `/data`; Codex data lives in `/data/home/.codex`.
- The `projects` volume is mounted at `/workspace`, which you can select in the web project picker.
- To work on existing host projects, create `compose.override.yaml` and mount your project directory at `/workspace`:

```yaml
services:
  chatgpt-webui:
    volumes:
      - /absolute/path/to/projects:/workspace
```

The process runs as the non-root user `1000:1000`; mounted directories must be readable and writable by that UID/GID. In this deployment, “host files” means **files visible inside the container**. Tool commands also run inside the container; extend the image to install additional development tools. For compatibility with standard Docker environments, the default command disables Electron's Chromium sandbox and uses basic password storage. No privileged mode, Docker socket, or host desktop mount is required. Protect the credentials stored in the data volume.

Rebuild after updating the adapter code; data volumes are retained:

```sh
docker compose up -d --build
# Stop and remove containers while retaining data volumes:
docker compose down
```

`docker compose down -v` deletes named volumes and their data; do not use it for a normal stop. To roll back, check out the previous code version and rebuild. Startup regenerates the App copy using that version's patches.

## Remote access

### SSH tunnel

Run this on the client machine:

```sh
ssh -N -L 18765:127.0.0.1:18765 user@target-machine
```

Then open the URL stored in `.logs/access-url` on the target machine. If the local forwarded port differs, set `CHATGPT_WEB_ORIGIN` on the host at startup to the address and port used by the browser.

### Nginx reverse proxy

Full template: [deploy/nginx.conf](deploy/nginx.conf). It assumes Nginx and the Web UI run on the same machine and serve the app at the root of a dedicated domain.

1. Replace `chatgpt.example.com` and the TLS certificate paths in the template.
2. Place the template in a configuration directory included by Nginx's `http {}` context, such as `/etc/nginx/conf.d/`.
3. Start the app with the matching public origin:

```sh
export CHATGPT_WEB_ORIGIN=https://chatgpt.example.com
export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'
scripts/start --ozone-platform=headless --disable-gpu
```

4. Run `sudo nginx -t` and reload Nginx after validation succeeds.
5. Open the **HTTPS** login URL printed in the terminal.

Make sure `CHATGPT_WEB_ORIGIN` exactly matches the browser-facing origin.

## Updates, rollback, and data locations

After updating the app, stop the Web UI and run:

```sh
scripts/start --ozone-platform=headless --disable-gpu
```

Startup checks the source ASAR and patch checksums, rebuilding the copy only when files are missing or changed. Resource links are updated when switching app sources.

Data locations:

| Path | Contents |
| --- | --- |
| `.deps/` | Local tools, app downloads, caches, and installation records; excluded from Git |
| `.runtime/` | Regenerable app copy and resource links |
| `.downloads/` | Client download staging; download links expire on service restart |
| `.uploads/` | Client files handed to the App; retain while conversations reference them |
| `.profile/` | Separate Electron sign-in state, preferences, and cache; retain during upgrades |
| `.logs/access-url` | Current access URL; treat it as a credential when it contains a token |
| `prepare-manifest.json` | Source app version, SHA-256, and patch SHA-256 values for the current copy |
| `.logs/prepare-history.jsonl` | Append-only preparation history |

All paths above are ignored by Git.

Only one browser WebSocket connection is currently supported. If a connection conflicts, close other connected tabs and try again.

## Development and validation

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
# With the app running and the browser connection closed:
npm run test:integration
# Attachment protocol checks (no browser automation):
node scripts/smoke-attachments.cjs
# Clipboard RPC, save-copy and local-resource protocol checks:
node scripts/smoke-native.cjs
# Static resource compression and cache protocol checks:
node scripts/smoke-static.cjs
# PDF worker resource checks:
node --experimental-vm-modules scripts/smoke-pdf.cjs
# Integration checks for token-free mode:
CHATGPT_WEB_AUTH=none npm run test:integration
```

When testing through a reverse proxy, also set `CHATGPT_WEB_URL=https://chatgpt.example.com`. Tests read `.logs/access-url` and only inspect directories and app information; they do not create conversations or send model requests.

```text
Original web UI → electronBridge / MessagePort adapter → WebSocket
                → Original Electron main process → Original renderer / preload → Original app services
```

[Change log (Chinese)](docs/OPERATIONS.md) · [MIT License](LICENSE)

The MIT license applies only to the new code in this repository. The ChatGPT name, interface, and installation assets belong to their respective rights holders and are not licensed or distributed by this project.
