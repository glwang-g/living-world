# Living World Engine

Rust engine prototype for ComputerScienceWorld, shaped after the boundaries in
the sibling `swarm-space` project.

```text
world-core      authoritative deterministic rules and state
world-runner    long-running tick orchestration and bot scheduling
world-bot       restricted Observation -> Intent contract
world-protocol  commands, snapshots, observations and structured events
app/            current browser space/viewer (not authoritative)
```

The first prototype is deliberately renderer-independent. The next adapter can
expose `WorldRunner` through HTTP/WebSocket while the browser only sends
commands and renders `WorldSnapshot`.

## Run tests

```bash
cargo test --manifest-path engine/Cargo.toml
```

## Run the authoritative world

Start this in one terminal. It keeps advancing the world once per second even
when no browser is connected:

```bash
npm run world:server
```

The browser in another terminal is then started with `npm run dev` and reads
`http://127.0.0.1:8787/api/snapshot`. It sends player actions to
`/api/command`; it does not own the authoritative tick.

World time follows the early-Minecraft cadence: one world hour advances every
50 real seconds, so one 24-hour world day takes 20 real minutes.

## macOS background service

To start the world automatically after login:

```bash
sh scripts/install-world-server-macos.sh
```

To remove the background service without deleting world data:

```bash
sh scripts/uninstall-world-server-macos.sh
```

The service uses `launchd`, keeps the world snapshot and event log under
`engine/data/`, and restarts automatically if the process exits.

During development the server prints only the important world-clock boundaries:
one log when daytime starts and one when nighttime starts each world day. The
same output is captured by launchd in `engine/data/world-server.stdout.log`.
