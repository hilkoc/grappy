# Grappy

**Gra**phical **Py**thon. An Electron app where you wire input values into Python functions
on a node canvas and run the result against a real IPython kernel.

- The canvas is React + React Flow, built with `electron-vite`.
- A calculation node holds one Python function; its source is edited in CodeMirror and its
  input ports come from the function's own signature.
- A local Python process (the **bridge**) owns the kernel and talks to the renderer over a
  WebSocket. The Electron main process starts it and tells the renderer which port to use.

## Development

### Python side

The bridge and its kernel live in [python/](python/) and are managed with
[Poetry](https://python-poetry.org/). The virtualenv is configured to be created in-project,
so it lands at `python/.venv`:

```sh
cd python
poetry install
```

That is all the setup the default configuration needs — the app looks for
`python/.venv/bin/python` (`python/.venv/Scripts/python.exe` on Windows) unless you tell it
otherwise.

To check the bridge on its own, without the UI:

```sh
cd python
poetry run python smoke_test.py
```

It starts a kernel, defines a function, runs it, and prints what came back.

### Node side

```sh
npm install
```

If this warning shows: _"The SUID sandbox helper binary was found, but is not configured
correctly. Rather than run without sandboxing I'm aborting now."_ run:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Run the app:

```sh
npm start
```

If Electron exits immediately with `SyntaxError: The requested module 'electron' does not
provide an export named 'BrowserWindow'`, the shell has `ELECTRON_RUN_AS_NODE=1` set — VS
Code's integrated terminal does this. Start the app from a plain terminal, or clear the
variable first:

```sh
env -u ELECTRON_RUN_AS_NODE npm start
```

Build, lint, format and typecheck:

```sh
npm run build
npm run lint
npm run format
npm run typecheck
```

### Choosing a different interpreter

**File → Select Python Interpreter…** picks any Python executable. The choice is stored in
`settings.json` under Electron's `userData` directory and the bridge restarts against it
right away, so that interpreter needs the dependencies from `python/pyproject.toml`
installed. **File → Use Bundled Interpreter** goes back to `python/.venv`, and **File →
Restart Kernel Bridge** restarts it with a fresh kernel.

## Using it

1. Add nodes from the toolbar: `+ Number Input`, `+ String Input`, `+ Calculation`. Each one
   asks for a name, which becomes its Python variable name (`First Name` → `First_Name`).
2. Type a value into an input node. It is sent to the kernel when the field loses focus or
   you press Enter, and the node then shows the real Python type it became.
3. Click a calculation node to open its editor on the right, write a single `def`, and press
   **Apply**. The node grows one input port per parameter, and a result node appears beside
   it.
4. Drag from an input node's right-hand dot onto a parameter to connect it. Each parameter
   takes one connection; a new one replaces the old.
5. Press **Run** once the kernel status reads `ready`. Results appear on the result nodes as
   each step finishes. A value too large to show inline gets a **view** button that opens it
   in the left panel — a `DataFrame` is rendered as a table.

An exception in one calculation marks that node and everything downstream of it; independent
branches keep running.

## Layout

```
src/
  main/        Electron main process: window, File menu, bridge lifecycle
  preload/     sandboxed contextBridge, the renderer's only IPC surface
  renderer/    React + TypeScript canvas
python/
  grappy_bridge/
    server.py          FastAPI app and the WebSocket protocol
    kernel_manager.py  jupyter_client wrapper: start a kernel, run code, read IOPub
    bootstrap.py       helpers executed inside the kernel at startup
```
