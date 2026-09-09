"""Smoke check for the bridge: start it, drive the acceptance scenario, print the result.

Run it from the ``python`` directory with the project's own interpreter:

    poetry run python smoke_test.py
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys

import websockets

GREETING_CODE = (
    "def say_greeting(first_name: str, age: int, years: int):\n"
    '    print(f"greeting {first_name}")\n'
    '    return f"Hello my name is {first_name}. '
    'In {years} years I will be {age + years}"\n'
)

#: Console lines the bridge pushed while the checks below ran.
console: list[dict] = []


async def read_until(socket, message_type: str) -> dict:
    while True:
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=120))
        if message.get("type") == "console":
            console.append(message)
            continue
        if message.get("type") == message_type:
            return message


async def send(socket, **message) -> None:
    await socket.send(json.dumps(message))


async def define(socket, function_id: str, var_name: str, **rest) -> dict:
    await send(
        socket,
        type="define_function",
        function_id=function_id,
        function_var_name=var_name,
        **rest,
    )
    return await read_until(socket, "function_defined")


async def run_step(socket, node_id: str, var_name: str, args: dict, output: str) -> dict:
    await send(
        socket,
        type="run",
        steps=[
            {
                "node_id": node_id,
                "function_var_name": var_name,
                "args": args,
                "output_var_name": output,
            }
        ],
    )
    result = await read_until(socket, "node_result")
    await read_until(socket, "run_complete")
    return result


def check(condition: bool, label: str) -> bool:
    print(("  ok  " if condition else "  FAIL") + "  " + label)
    return condition


async def drive(port: int) -> int:
    async with websockets.connect(f"ws://127.0.0.1:{port}") as socket:
        status = await read_until(socket, "kernel_status")
        while status["status"] == "connecting":
            status = await read_until(socket, "kernel_status")
        if status["status"] != "ready":
            print("kernel failed:", status.get("error"), file=sys.stderr)
            return 1

        passed = True

        for var_name, value, kind in [
            ("Age", "30", "number"),
            ("First_Name", "Ada", "string"),
            ("Years", "5", "number"),
            ("Letters", "hello world", "string"),
        ]:
            await send(
                socket,
                type="set_input",
                node_id=var_name,
                var_name=var_name,
                value=value,
                value_kind=kind,
            )
            result = await read_until(socket, "value_set")
            passed &= check(not result.get("error"), f"set_input {var_name} -> {result}")

        # A function written in the code panel.
        defined = await define(socket, "fn-1", "Greeting__fn", kind="source", code=GREETING_CODE)
        passed &= check(not defined.get("error"), f"define source {defined.get('params')}")

        greeting = await run_step(
            socket,
            "c1",
            "Greeting__fn",
            {"first_name": "First_Name", "age": "Age", "years": "Years"},
            "Greeting",
        )
        passed &= check(
            "Hello my name is Ada. In 5 years I will be 35" in (greeting.get("short_repr") or ""),
            f"run source function -> {greeting.get('short_repr')}",
        )

        # The same definition backs two calculation nodes; only the output name differs.
        again = await run_step(
            socket,
            "c2",
            "Greeting__fn",
            {"first_name": "First_Name", "age": "Age", "years": "Years"},
            "Greeting_Two",
        )
        passed &= check(
            again.get("short_repr") == greeting.get("short_repr"),
            "one definition backs a second calculation node",
        )

        # An imported name. Counter's only parameter is positional-only.
        imported = await define(socket, "fn-2", "Counter__fn", kind="import", path="collections.Counter")
        passed &= check(
            not imported.get("error") and bool(imported.get("params")),
            f"import collections.Counter -> {imported.get('params')} {imported.get('error') or ''}",
        )

        counted = await run_step(
            socket, "c3", "Counter__fn", {"iterable": "Letters"}, "Letter_Counts"
        )
        passed &= check(
            counted.get("type_name") == "Counter" and not counted.get("error"),
            f"call an imported callable -> {counted.get('type_name')} {counted.get('error') or ''}",
        )

        bad = await define(socket, "fn-3", "Missing__fn", kind="import", path="nope.NotAThing")
        passed &= check(bool(bad.get("error")), f"a bad import reports an error -> {bad.get('error')}")

        await send(socket, type="describe_value", var_name="Greeting")
        described = await read_until(socket, "value_description")
        passed &= check(
            "Hello my name is Ada" in (described.get("full_repr") or ""), "describe_value"
        )

        passed &= check(
            any("greeting Ada" in line.get("text", "") for line in console),
            f"stdout reached the console ({len(console)} console messages)",
        )

    print("smoke test passed" if passed else "smoke test FAILED", file=sys.stderr if not passed else sys.stdout)
    return 0 if passed else 1


async def main() -> int:
    process = subprocess.Popen(
        [sys.executable, "-m", "grappy_bridge.server"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        handshake = process.stdout.readline()
        port = json.loads(handshake)["port"]
        print("bridge port:", port)
        return await drive(port)
    finally:
        process.terminate()
        process.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
