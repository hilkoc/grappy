# grappy-bridge

The Python side of Grappy. It owns a real IPython kernel and exposes it to the Electron
renderer over a local WebSocket.

```sh
poetry install     # creates ./.venv (in-project)
poetry run python -m grappy_bridge.server
```

The server binds to `127.0.0.1` on an OS-assigned free port and prints `{"port": <n>}` as
its first stdout line. The Electron main process reads that line to learn where to point
the renderer.
