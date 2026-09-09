# Grappy

**Gra**phical **Py**thon. An Electron app where you wire input values into Python functions
on a node canvas and run the result against a real IPython kernel.

- The canvas is React + React Flow, built with `electron-vite`.
- A calculation node calls a function: either Python you write in CodeMirror, or a fully
  qualified name you import, such as `collections.Counter`. Its input ports come from the
  function's own signature, as the kernel reports it.
- One function can back several calculation nodes. Edit it once and every node using it
  follows.
- A local Python process (the **bridge**) owns the kernel and talks to the renderer over a
  WebSocket. The Electron main process starts it and tells the renderer which port to use.
- Graphs are saved as JSON, laid out for small diffs in version control.

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

Build, lint, format, typecheck, and check the saved-file format:

```sh
npm run build
npm run lint
npm run format
npm run typecheck
npm run check:persistence
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
3. A calculation node asks which function it calls. Pick one that already exists, or let it
   make a new one named after the node — either Python you write, or a name to import.
4. Click a calculation node to open its function on the right. Write a single `def`, or
   switch to **Import name** and enter something like `collections.Counter`, then press
   **Apply**. The node grows one input port per parameter and a result node appears beside
   it. If several nodes share the function, they all update together.
5. Drag from an input node's right-hand dot onto a parameter to connect it. Each parameter
   takes one connection; a new one replaces the old.
6. Press **Run** once the kernel status reads `ready`. Results appear on the result nodes as
   each step finishes. A value too large to show inline gets a **view** button that opens it
   in the left panel — a `DataFrame` is rendered as a table.

An exception in one calculation marks that node and everything downstream of it; independent
branches keep running.

### The console

**View → Console** opens a panel along the bottom showing everything the kernel writes:
your own `print` output, anything on stderr, and the full traceback behind the one-line
error a node shows. Close it from the same menu item or the × in its header.

### Saving and loading

**File → Save Graph** and **File → Open Graph…** write and read a JSON file. It holds the
nodes, the edges, the functions and the values you typed — not the results, which the
kernel recomputes. The layout is chosen so that version control sees small diffs: keys in a
fixed order, arrays sorted by id, positions rounded to whole pixels, and Python source kept
as one array element per line rather than one long string of `\n`.

```json
{
  "version": 1,
  "functions": [
    {
      "id": "fn-1",
      "kind": "source",
      "name": "Greeting",
      "varName": "Greeting__fn",
      "params": [
        {
          "name": "first_name",
          "annotation": "str",
          "has_default": false,
          "positional_only": false
        }
      ],
      "code": ["def say_greeting(first_name: str):", "    return f\"Hi {first_name}\""]
    }
  ],
  "nodes": [
    {
      "id": "node-1",
      "type": "inputValue",
      "name": "First Name",
      "varName": "First_Name",
      "position": { "x": 40, "y": 60 },
      "valueKind": "string",
      "value": "Ada"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "node-1",
      "sourceHandle": null,
      "target": "node-3",
      "targetHandle": "first_name"
    }
  ]
}
```

Opening a file replays every function and every input value into the kernel, so a graph
picks up where it left off. The same replay happens whenever the kernel restarts. The window
title shows the file name, with a leading dot while there are unsaved changes.

## Layout

```
src/
  main/        Electron main process: window, menus, files, bridge lifecycle
  preload/     sandboxed contextBridge, the renderer's only IPC surface
  renderer/    React + TypeScript canvas
scripts/
  check-persistence.ts   round-trip check for the saved file format
python/
  grappy_bridge/
    server.py          FastAPI app and the WebSocket protocol
    kernel_manager.py  jupyter_client wrapper: start a kernel, run code, read IOPub
    bootstrap.py       helpers executed inside the kernel at startup
```
