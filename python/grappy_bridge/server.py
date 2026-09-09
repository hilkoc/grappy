"""FastAPI WebSocket server that fronts a single IPython kernel.

The renderer talks to this process directly. It binds to ``127.0.0.1`` on an
OS-assigned port and prints ``{"port": <n>}`` as its first stdout line so that the
Electron main process can hand the port to the renderer.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import keyword
import logging
import os
import socket
import stat
import sys
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .kernel_manager import KernelSession, OutputCallback

logger = logging.getLogger("grappy.bridge")

HOST = "127.0.0.1"


class ProtocolError(ValueError):
    """A malformed message from the renderer."""


class BridgeState:
    """Kernel lifecycle shared by every WebSocket connection."""

    def __init__(self) -> None:
        self.session = KernelSession()
        self.status = "connecting"
        self.error: str | None = None
        self.settled = asyncio.Event()

    async def start(self) -> None:
        try:
            await self.session.start()
            self.status = "ready"
        except Exception as exc:  # surfaced to the UI as the kernel status
            logger.exception("Kernel failed to start")
            self.status = "error"
            self.error = str(exc)
        finally:
            self.settled.set()

    async def shutdown(self) -> None:
        with contextlib.suppress(Exception):
            await self.session.shutdown()

    def status_message(self) -> dict:
        return {"type": "kernel_status", "status": self.status, "error": self.error}


def require_identifier(name: object, field: str) -> str:
    if not isinstance(name, str) or not name.isidentifier() or keyword.iskeyword(name):
        raise ProtocolError(f"{field} is not a valid Python identifier: {name!r}")
    return name


def coerce_input_value(value: object, value_kind: str) -> int | float | str:
    """Turn a raw JSON input value into the Python value the kernel should hold."""
    if value_kind == "string":
        return "" if value is None else str(value)
    if value_kind != "number":
        raise ProtocolError(f"Unknown value_kind: {value_kind!r}")

    text = str(value).strip()
    if not text:
        raise ProtocolError("Enter a number.")
    try:
        return int(text)
    except ValueError:
        pass
    try:
        number = float(text)
    except ValueError as exc:
        raise ProtocolError(f"Not a number: {text!r}") from exc
    return int(number) if number.is_integer() else number


def console_sink(websocket: WebSocket, node_id: object = None) -> OutputCallback:
    """Forward whatever the kernel writes to the renderer's console panel."""

    async def send(stream: str, text: str) -> None:
        await websocket.send_json(
            {"type": "console", "stream": stream, "text": text, "node_id": node_id}
        )

    return send


async def handle_define_function(
    state: BridgeState, message: dict, console: OutputCallback
) -> dict:
    """Define one function, either from source or by importing a fully qualified name.

    A function is defined once and can back any number of calculation nodes, so this is
    keyed by function rather than by node.
    """
    function_var_name = require_identifier(message.get("function_var_name"), "function_var_name")
    kind = message.get("kind", "source")
    if kind == "source":
        source = message.get("code") or ""
        code = f"print(_grappy_define({source!r}, {function_var_name!r}))"
    elif kind == "import":
        path = str(message.get("path") or "")
        code = f"print(_grappy_import({path!r}, {function_var_name!r}))"
    else:
        raise ProtocolError(f"Unknown function kind: {kind!r}")

    result = await state.session.execute_payload(code, console)
    return {
        "type": "function_defined",
        "function_id": message.get("function_id"),
        "function_var_name": function_var_name,
        "params": result.get("params", []),
        "error": result.get("error"),
    }


async def handle_set_input(state: BridgeState, message: dict, console: OutputCallback) -> dict:
    node_id = message.get("node_id")
    var_name = require_identifier(message.get("var_name"), "var_name")
    try:
        value = coerce_input_value(message.get("value"), message.get("value_kind", "string"))
    except ProtocolError as exc:
        return {"type": "value_set", "node_id": node_id, "error": str(exc)}

    result = await state.session.execute_payload(
        f"print(_grappy_set({var_name!r}, {value!r}))", console
    )
    return {
        "type": "value_set",
        "node_id": node_id,
        "type_name": result.get("type_name"),
        "short_repr": result.get("short_repr"),
        "is_large": result.get("is_large", False),
        "error": result.get("error"),
    }


async def handle_describe_value(
    state: BridgeState, message: dict, console: OutputCallback
) -> dict:
    var_name = require_identifier(message.get("var_name"), "var_name")
    result = await state.session.execute_payload(
        f"print(_grappy_describe_name({var_name!r}))", console
    )
    return {
        "type": "value_description",
        "var_name": var_name,
        "full_repr": result.get("full_repr"),
        "html_table": result.get("html_table"),
        "error": result.get("error"),
    }


async def handle_run(state: BridgeState, websocket: WebSocket, message: dict) -> None:
    """Execute the steps in the order the renderer computed, skipping blocked branches.

    A step whose inputs come from a step that already failed is reported as blocked and
    never executed, but independent branches keep running.
    """
    steps = message.get("steps") or []
    failed_vars: set[str] = set()

    for step in steps:
        node_id = step.get("node_id")
        function_var_name = require_identifier(step.get("function_var_name"), "function_var_name")
        output_var_name = require_identifier(step.get("output_var_name"), "output_var_name")
        args = {
            require_identifier(param, "param"): require_identifier(source, "source")
            for param, source in (step.get("args") or {}).items()
        }

        blocked = sorted(failed_vars.intersection(args.values()))
        if blocked:
            failed_vars.add(output_var_name)
            await websocket.send_json(
                {
                    "type": "node_result",
                    "node_id": node_id,
                    "output_var_name": output_var_name,
                    "error": f"Blocked by an upstream failure: {', '.join(blocked)}",
                }
            )
            continue

        result = await state.session.execute_payload(
            f"print(_grappy_call({function_var_name!r}, {output_var_name!r}, {args!r}))",
            console_sink(websocket, node_id),
        )
        if result.get("error"):
            failed_vars.add(output_var_name)
        await websocket.send_json(
            {
                "type": "node_result",
                "node_id": node_id,
                "output_var_name": output_var_name,
                "type_name": result.get("type_name"),
                "short_repr": result.get("short_repr"),
                "is_large": result.get("is_large", False),
                "error": result.get("error"),
            }
        )

    await websocket.send_json({"type": "run_complete"})


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = BridgeState()
    app.state.bridge = state
    starter = asyncio.create_task(state.start())
    try:
        yield
    finally:
        starter.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await starter
        await state.shutdown()


app = FastAPI(title="Grappy bridge", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    state: BridgeState = app.state.bridge
    return {"status": state.status, "error": state.error}


@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket) -> None:
    state: BridgeState = websocket.app.state.bridge
    await websocket.accept()
    await websocket.send_json(state.status_message())
    if not state.settled.is_set():
        await state.settled.wait()
        await websocket.send_json(state.status_message())

    try:
        while True:
            message = await websocket.receive_json()
            await dispatch(state, websocket, message)
    except WebSocketDisconnect:
        return
    except json.JSONDecodeError:
        await websocket.close(code=1003, reason="Expected JSON")


async def dispatch(state: BridgeState, websocket: WebSocket, message: dict) -> None:
    message_type = message.get("type")
    console = console_sink(websocket, message.get("node_id"))
    try:
        if message_type == "run":
            await handle_run(state, websocket, message)
            return
        if message_type == "define_function":
            response = await handle_define_function(state, message, console)
        elif message_type == "set_input":
            response = await handle_set_input(state, message, console)
        elif message_type == "describe_value":
            response = await handle_describe_value(state, message, console)
        else:
            response = {"type": "error", "error": f"Unknown message type: {message_type!r}"}
    except ProtocolError as exc:
        response = {"type": "error", "error": str(exc), "node_id": message.get("node_id")}
    except Exception as exc:  # never let one bad message kill the connection
        logger.exception("Handler for %r failed", message_type)
        response = {"type": "error", "error": str(exc), "node_id": message.get("node_id")}
    await websocket.send_json(response)


def exit_when_stdin_closes(server: uvicorn.Server) -> None:
    """Shut down once the parent closes our stdin.

    Electron holds the write end of that pipe open for as long as it lives. If it is killed
    without running its own cleanup, the pipe closes, and this keeps the kernel from being
    left behind as an orphan.

    Only a pipe means "a parent is holding this open"; Node hands us a socket pair rather
    than a FIFO, so both count. A terminal or /dev/null does not, which leaves running the
    bridge by hand unaffected.
    """
    if sys.stdin is None:
        return
    try:
        mode = os.fstat(sys.stdin.fileno()).st_mode
    except OSError:
        return
    if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
        return

    def watch() -> None:
        try:
            sys.stdin.read()
        except Exception:
            pass
        server.should_exit = True

    threading.Thread(target=watch, daemon=True, name="parent-watchdog").start()


def main() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((HOST, 0))
    # Listen before announcing the port, so a client that connects immediately lands in the
    # backlog instead of being refused while uvicorn is still starting up.
    listener.listen(128)
    port = listener.getsockname()[1]

    # The Electron main process reads exactly this line to find the bridge.
    sys.stdout.write(json.dumps({"port": port}) + "\n")
    sys.stdout.flush()

    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    exit_when_stdin_closes(server)
    server.run(sockets=[listener])


if __name__ == "__main__":
    main()
