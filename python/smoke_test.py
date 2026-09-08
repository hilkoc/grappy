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
    '    return f"Hello my name is {first_name}. '
    'In {years} years I will be {age + years}"\n'
)


async def read_until(socket, message_type: str) -> dict:
    while True:
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=120))
        if message.get("type") == message_type:
            return message


async def drive(port: int) -> int:
    async with websockets.connect(f"ws://127.0.0.1:{port}") as socket:
        status = await read_until(socket, "kernel_status")
        while status["status"] == "connecting":
            status = await read_until(socket, "kernel_status")
        if status["status"] != "ready":
            print("kernel failed:", status.get("error"), file=sys.stderr)
            return 1

        for node_id, var_name, value, kind in [
            ("n1", "Age", "30", "number"),
            ("n2", "First_Name", "Ada", "string"),
            ("n3", "Years", "5", "number"),
        ]:
            await socket.send(
                json.dumps(
                    {
                        "type": "set_input",
                        "node_id": node_id,
                        "var_name": var_name,
                        "value": value,
                        "value_kind": kind,
                    }
                )
            )
            print("value_set:", await read_until(socket, "value_set"))

        await socket.send(
            json.dumps(
                {
                    "type": "define_calculation",
                    "node_id": "c1",
                    "code": GREETING_CODE,
                    "function_var_name": "Greeting__fn",
                }
            )
        )
        defined = await read_until(socket, "calculation_defined")
        print("calculation_defined:", defined)
        if defined.get("error"):
            return 1

        await socket.send(
            json.dumps(
                {
                    "type": "run",
                    "steps": [
                        {
                            "node_id": "c1",
                            "function_var_name": "Greeting__fn",
                            "args": {
                                "first_name": "First_Name",
                                "age": "Age",
                                "years": "Years",
                            },
                            "output_var_name": "Greeting",
                        }
                    ],
                }
            )
        )
        result = await read_until(socket, "node_result")
        print("node_result:", result)
        await read_until(socket, "run_complete")

        await socket.send(json.dumps({"type": "describe_value", "var_name": "Greeting"}))
        print("value_description:", await read_until(socket, "value_description"))

        expected = "Hello my name is Ada. In 5 years I will be 35"
        if result.get("error") or expected not in (result.get("short_repr") or ""):
            print("unexpected result", file=sys.stderr)
            return 1

    print("smoke test passed")
    return 0


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
