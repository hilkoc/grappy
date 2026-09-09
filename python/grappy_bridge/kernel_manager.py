"""A thin async wrapper around ``jupyter_client``: start a kernel, run code, read IOPub."""

from __future__ import annotations

import asyncio
import json
import queue
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from jupyter_client.manager import AsyncKernelManager

#: Key that :mod:`grappy_bridge.bootstrap` stamps on every payload it prints, so that a
#: user's own ``print`` output is never mistaken for a bridge response.
PAYLOAD_MARKER = "_grappy"

BOOTSTRAP_PATH = Path(__file__).with_name("bootstrap.py")

STARTUP_TIMEOUT = 60.0
EXECUTE_TIMEOUT = 300.0

#: IPython colours its tracebacks. The console panel shows plain text, so the codes go.
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

#: Called with (stream, text) for everything the kernel writes that is not a bridge payload.
OutputCallback = Callable[[str, str], Awaitable[None]]


class KernelError(RuntimeError):
    """Raised when the kernel cannot be started or stops answering."""


@dataclass
class ExecutionResult:
    """Everything one execute request produced on the IOPub channel."""

    stdout: str = ""
    error: str | None = None
    payload: dict | None = None
    user_output: list[str] = field(default_factory=list)


def _format_error(content: dict) -> str:
    name = content.get("ename") or "Error"
    value = content.get("evalue") or ""
    return f"{name}: {value}".strip().rstrip(":")


def _strip_ansi(text: str) -> str:
    return ANSI_ESCAPE.sub("", text)


def _as_payload(line: str) -> dict | None:
    """Return the bridge payload this stdout line carries, or None if it is user output."""
    stripped = line.strip()
    if not (stripped.startswith("{") and stripped.endswith("}")):
        return None
    try:
        candidate = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    if not isinstance(candidate, dict) or not candidate.get(PAYLOAD_MARKER):
        return None
    candidate.pop(PAYLOAD_MARKER, None)
    return candidate


class KernelSession:
    """Owns a single IPython kernel and serializes all execution against it."""

    def __init__(self, kernel_name: str = "python3") -> None:
        self.kernel_name = kernel_name
        self._manager: AsyncKernelManager | None = None
        self._client = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._manager = AsyncKernelManager(kernel_name=self.kernel_name)
        await self._manager.start_kernel()
        self._client = self._manager.client()
        self._client.start_channels()
        try:
            await self._client.wait_for_ready(timeout=STARTUP_TIMEOUT)
        except RuntimeError as exc:
            raise KernelError(f"Kernel did not become ready: {exc}") from exc

        result = await self.execute(BOOTSTRAP_PATH.read_text(encoding="utf-8"))
        if result.error:
            raise KernelError(f"Kernel bootstrap failed: {result.error}")

    async def shutdown(self) -> None:
        if self._client is not None:
            self._client.stop_channels()
            self._client = None
        if self._manager is not None:
            await self._manager.shutdown_kernel(now=True)
            self._manager = None

    async def execute(
        self,
        code: str,
        timeout: float = EXECUTE_TIMEOUT,
        on_output: OutputCallback | None = None,
    ) -> ExecutionResult:
        """Run ``code`` and collect its IOPub output until the kernel goes idle again.

        Anything the code writes that is not a bridge payload is handed to ``on_output``
        as it arrives, line by line, so the console panel fills in during a long run
        rather than only at the end.
        """
        if self._client is None:
            raise KernelError("Kernel is not running.")

        async def emit(stream: str, text: str) -> None:
            if on_output is not None:
                await on_output(stream, _strip_ansi(text))

        async with self._lock:
            client = self._client
            msg_id = client.execute(code, store_history=False, allow_stdin=False)
            loop = asyncio.get_running_loop()
            deadline = loop.time() + timeout
            chunks: list[str] = []
            pending = ""
            payload: dict | None = None
            user_output: list[str] = []
            error: str | None = None

            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise KernelError("Timed out waiting for the kernel to finish.")
                try:
                    message = await client.get_iopub_msg(timeout=remaining)
                except (queue.Empty, asyncio.TimeoutError) as exc:
                    raise KernelError("Timed out waiting for the kernel to finish.") from exc

                if message.get("parent_header", {}).get("msg_id") != msg_id:
                    continue

                msg_type = message["header"]["msg_type"]
                content = message.get("content", {})
                if msg_type == "stream":
                    text = content.get("text", "")
                    if content.get("name") != "stdout":
                        await emit("stderr", text)
                        continue
                    chunks.append(text)
                    pending += text
                    while "\n" in pending:
                        line, pending = pending.split("\n", 1)
                        found = _as_payload(line)
                        if found is not None:
                            payload = found
                        elif line:
                            user_output.append(line)
                            await emit("stdout", line + "\n")
                elif msg_type == "error":
                    error = _format_error(content)
                    traceback = "\n".join(content.get("traceback") or [])
                    if traceback:
                        await emit("stderr", traceback + "\n")
                elif msg_type == "status" and content.get("execution_state") == "idle":
                    break

            # Output that never ended in a newline still belongs to somebody.
            if pending:
                found = _as_payload(pending)
                if found is not None:
                    payload = found
                else:
                    user_output.append(pending)
                    await emit("stdout", pending)

        return ExecutionResult(
            stdout="".join(chunks), error=error, payload=payload, user_output=user_output
        )

    async def execute_payload(self, code: str, on_output: OutputCallback | None = None) -> dict:
        """Run ``code`` (which must print one bridge payload) and return that payload.

        A Python exception, or a payload that carries its own ``error``, both come back as
        ``{"error": ...}`` so that callers have a single failure shape to handle.
        """
        result = await self.execute(code, on_output=on_output)
        if result.error:
            return {"error": result.error}
        if result.payload is None:
            detail = result.stdout.strip() or "no output"
            return {"error": f"Kernel returned no result ({detail})."}
        return result.payload
