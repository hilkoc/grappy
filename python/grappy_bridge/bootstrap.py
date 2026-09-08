"""Helper functions that are injected into the IPython kernel at startup.

The *source* of this module is executed inside the kernel, so it may not import
anything from the ``grappy_bridge`` package and it may not rely on any state of
the bridge process. Everything it defines lands in the kernel's global namespace,
which is the same namespace the user's own variables live in, so every name here
is prefixed with ``_grappy`` to keep collisions unlikely.

The bridge reads results off the kernel's IOPub stream, so every helper returns a
JSON string that the caller prints. Each payload carries a ``_grappy`` marker key
that lets the bridge tell its own output apart from the user's ``print`` calls.
"""

import inspect as _grappy_inspect
import json as _grappy_json
import keyword as _grappy_keyword
import pprint as _grappy_pprint

_GRAPPY_SHORT_REPR_LIMIT = 100
_GRAPPY_FULL_REPR_LIMIT = 200_000
_GRAPPY_LARGE_CONTAINER_LENGTH = 10
_GRAPPY_LARGE_TEXT_LENGTH = 200
_GRAPPY_LARGE_FRAME_ROWS = 10


def _grappy_payload(**fields):
    """Serialize a response payload, tagged so the bridge can find it in the stream."""
    fields["_grappy"] = 1
    return _grappy_json.dumps(fields, default=str)


def _grappy_is_dataframe(value):
    kind = type(value)
    module = getattr(kind, "__module__", "") or ""
    # pandas 3 reports "pandas" for its public classes; older versions report the
    # defining submodule, such as "pandas.core.frame".
    in_pandas = module == "pandas" or module.startswith("pandas.")
    return in_pandas and kind.__name__ in ("DataFrame", "Series")


def _grappy_short_repr(value):
    try:
        text = repr(value)
    except Exception as exc:  # a broken __repr__ must not break the whole run
        return "<unrepresentable: {}>".format(exc), False
    text = " ".join(text.split())
    if len(text) > _GRAPPY_SHORT_REPR_LIMIT:
        return text[: _GRAPPY_SHORT_REPR_LIMIT - 1] + "…", True
    return text, False


def _grappy_is_large(value, was_truncated):
    if _grappy_is_dataframe(value):
        try:
            return len(value.index) > _GRAPPY_LARGE_FRAME_ROWS or was_truncated
        except Exception:
            return True
    if isinstance(value, (str, bytes, bytearray)):
        return len(value) > _GRAPPY_LARGE_TEXT_LENGTH
    if isinstance(value, (list, tuple, set, frozenset, dict, range)):
        try:
            return len(value) > _GRAPPY_LARGE_CONTAINER_LENGTH
        except TypeError:
            return True
    return was_truncated


def _grappy_describe(value):
    """Describe a value for inline display on a node."""
    short_repr, was_truncated = _grappy_short_repr(value)
    return _grappy_payload(
        type_name=type(value).__name__,
        short_repr=short_repr,
        is_large=_grappy_is_large(value, was_truncated),
    )


def _grappy_describe_full(value):
    """Describe a value for the detail panel: an HTML table, or plain text."""
    if _grappy_is_dataframe(value) and hasattr(value, "to_html"):
        try:
            return _grappy_payload(html_table=value.to_html())
        except Exception:
            pass
    try:
        if _grappy_is_dataframe(value):
            text = value.to_string()
        elif isinstance(value, str):
            text = value
        else:
            text = _grappy_pprint.pformat(value, width=100)
    except Exception as exc:
        text = "<unrepresentable: {}>".format(exc)
    if len(text) > _GRAPPY_FULL_REPR_LIMIT:
        text = text[:_GRAPPY_FULL_REPR_LIMIT] + "\n… (truncated)"
    return _grappy_payload(full_repr=text)


def _grappy_annotation_text(annotation):
    if annotation is _grappy_inspect.Parameter.empty:
        return ""
    if isinstance(annotation, str):
        return annotation
    return _grappy_inspect.formatannotation(annotation)


def _grappy_define(source, target_name):
    """Execute a function definition and bind the resulting function to ``target_name``.

    The source is executed against the kernel's own globals, so the function can use
    anything the user imported earlier, and anything the source itself defines stays
    available afterwards. When the source defines several functions, the last one wins.
    """
    namespace = {}
    try:
        exec(source, globals(), namespace)
    except Exception as exc:
        return _grappy_payload(error="{}: {}".format(type(exc).__name__, exc))

    functions = [value for value in namespace.values() if _grappy_inspect.isfunction(value)]
    if not functions:
        return _grappy_payload(error="No function definition found in the calculation code.")

    function = functions[-1]
    globals().update(namespace)
    globals()[target_name] = function

    try:
        signature = _grappy_inspect.signature(function)
    except (TypeError, ValueError) as exc:
        return _grappy_payload(error="Cannot inspect signature: {}".format(exc))

    params = []
    for parameter in signature.parameters.values():
        if parameter.kind in (parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD):
            continue
        params.append(
            {
                "name": parameter.name,
                "annotation": _grappy_annotation_text(parameter.annotation),
                "has_default": parameter.default is not parameter.empty,
            }
        )
    return _grappy_payload(function_name=function.__name__, params=params)


def _grappy_is_identifier(name):
    return isinstance(name, str) and name.isidentifier() and not _grappy_keyword.iskeyword(name)


def _grappy_set(name, value):
    """Bind a user input value to ``name`` and describe what it turned into."""
    globals()[name] = value
    return _grappy_describe(value)


def _grappy_call(function_name, output_name, args):
    """Call a defined calculation and store its result under ``output_name``.

    ``args`` maps each parameter name to the name of the variable that feeds it. Names
    that do not exist yet are reported instead of raising, so an unset input reads as a
    clear message rather than a ``KeyError``.
    """
    missing = sorted({name for name in [function_name, *args.values()] if name not in globals()})
    if missing:
        return _grappy_payload(error="Not available in the kernel: " + ", ".join(missing))
    globals()[output_name] = globals()[function_name](
        **{param: globals()[source] for param, source in args.items()}
    )
    return _grappy_describe(globals()[output_name])


def _grappy_describe_name(name):
    """Describe the value bound to ``name`` for the detail panel."""
    if name not in globals():
        return _grappy_payload(error="Not available in the kernel: " + name)
    return _grappy_describe_full(globals()[name])
