"""Bootstrap that runs main.py with notebook-style rich output.

Bare top-level expressions are displayed instead of discarded, and objects that
advertise a rich form (the `_repr_*_` protocol IPython established) are emitted
as MIME payloads on a sentinel-wrapped stdout line for the frontend to render.

Nothing here imports a third-party library: rich output is opt-in by the object,
so a script that produces none pays only for one ast.parse.
"""

import ast
import base64
import io
import json
import re
import sys
import traceback

SOURCE = "main.py"

# OSC-style sentinel, chosen so it can't plausibly collide with real output and
# stays inert if a payload ever reaches a real terminal. Parsed by
# `parseDisplayPayload` in packages/editor/src/code-runner/contract.ts.
START = "\x1b]myelin-display;"
END = "\x07"

# Payloads cross the IPC boundary and land in the webview, so a runaway repr
# must not be able to wedge the UI.
MAX_PAYLOAD_CHARS = 8 * 1024 * 1024

# Probed in order; the first one an object implements wins.
RICH_REPRS = (
    ("_repr_png_", "image/png"),
    ("_repr_jpeg_", "image/jpeg"),
    ("_repr_svg_", "image/svg+xml"),
    ("_repr_html_", "text/html"),
    ("_repr_latex_", "text/latex"),
)
BINARY_MIMES = ("image/png", "image/jpeg")

# Vega and Vega-Lite payloads arrive through `_repr_mimebundle_` under a
# version-stamped mime (Altair 5 emits application/vnd.vegalite.v5+json). They
# are all normalized to one mime because the renderer reads the dialect and
# version from the spec's own $schema.
VEGA_MIME_RE = re.compile(r"^application/vnd\.vega(-?lite)?\.v\d+\+json$")
VEGA_MIME = "application/vnd.vega+json"
# Probed when a mimebundle carries no spec. Deliberately excludes text/html:
# the HTML a charting library publishes there is a wrapper that pulls its
# renderer from a CDN, which the sandboxed output frame has no network for.
# Self-contained HTML comes through `_repr_html_` instead.
BUNDLE_MIMES = ("image/png", "image/svg+xml")


def _emit(mime, data):
    if len(data) > MAX_PAYLOAD_CHARS:
        print(
            f"[myelin] {mime} output too large to display ({len(data)} chars)",
            file=sys.stderr,
        )
        return
    sys.stdout.write(START + json.dumps({"mime": mime, "data": data}) + END + "\n")
    sys.stdout.flush()


def _encode(mime, value):
    """Normalize a `_repr_*_` return value to a JSON-safe string."""
    if mime in BINARY_MIMES and not isinstance(value, str):
        return base64.b64encode(value).decode("ascii")
    return value


def _mimebundle(obj):
    """The object's `_repr_mimebundle_` dict, or None. This is how Altair,
    Plotly and ipywidgets publish themselves; `_repr_*_` is the older, narrower
    protocol."""
    fn = getattr(obj, "_repr_mimebundle_", None)
    if not callable(fn):
        return None
    try:
        bundle = fn()
    except Exception:
        return None
    # A bundle may be returned as (data, metadata).
    if isinstance(bundle, tuple) and bundle:
        bundle = bundle[0]
    return bundle if isinstance(bundle, dict) else None


def _vega_spec(obj, bundle):
    """A Vega or Vega-Lite spec as JSON, or None.

    Only objects that publish a mimebundle are considered, which keeps the
    `to_dict` probe below away from the many unrelated types that happen to
    have a method by that name.
    """
    if bundle is None:
        return None
    for mime, payload in bundle.items():
        if VEGA_MIME_RE.match(mime) and payload:
            return payload if isinstance(payload, str) else json.dumps(payload)

    # Altair 6's default renderer publishes only a CDN-loading HTML page, so the
    # spec has to be taken from the chart directly.
    to_dict = getattr(obj, "to_dict", None)
    if not callable(to_dict):
        return None
    try:
        spec = to_dict()
    except Exception as err:
        print(f"[myelin] could not read chart spec: {err}", file=sys.stderr)
        return None
    if isinstance(spec, dict) and "vega" in str(spec.get("$schema", "")):
        return json.dumps(spec)
    return None


def _rich(obj):
    """The object's richest advertised form as (mime, data), or None."""
    bundle = _mimebundle(obj)
    spec = _vega_spec(obj, bundle)
    if spec:
        return VEGA_MIME, spec

    for attr, mime in RICH_REPRS:
        fn = getattr(obj, attr, None)
        if not callable(fn):
            continue
        try:
            value = fn()
        except Exception:
            continue
        if value:
            return mime, _encode(mime, value)

    if bundle:
        for mime in BUNDLE_MIMES:
            payload = bundle.get(mime)
            if payload:
                return mime, _encode(mime, payload)

    # Matplotlib figures (and the seaborn/plotnine wrappers around them) don't
    # implement the protocols above: core matplotlib leaves the rich repr to
    # IPython's inline backend, which isn't loaded here. `savefig` is the shared
    # shape those objects do expose.
    save = getattr(obj, "savefig", None)
    if callable(save):
        buf = io.BytesIO()
        try:
            save(buf, format="png", dpi=144, bbox_inches="tight")
        except Exception:
            return None
        return "image/png", base64.b64encode(buf.getvalue()).decode("ascii")

    return None


def display(obj):
    """Render `obj` richly if it can be, else fall back to its repr."""
    if obj is None:
        return
    found = _rich(obj)
    if found:
        _emit(*found)
    else:
        print(repr(obj))


def _with_auto_display(tree):
    """Wrap bare top-level expressions in a display() call, the way a notebook
    cell shows its trailing value. A leading docstring is left alone. Node
    locations are preserved so tracebacks still cite the user's line numbers."""
    body = tree.body
    start = 1 if body and _is_docstring(body[0]) else 0
    for node in body[start:]:
        if isinstance(node, ast.Expr):
            node.value = ast.Call(
                func=ast.Name(id="__myelin_display__", ctx=ast.Load()),
                args=[node.value],
                keywords=[],
            )
    ast.fix_missing_locations(tree)
    return tree


def _is_docstring(node):
    return (
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    )


def main():
    with open(SOURCE, "r", encoding="utf-8") as handle:
        source = handle.read()

    try:
        code = compile(_with_auto_display(ast.parse(source, SOURCE)), SOURCE, "exec")
    except SyntaxError as err:
        sys.stderr.write("".join(traceback.format_exception_only(type(err), err)))
        return 1

    # `display` is exposed for explicit use and may be shadowed by the script;
    # the auto-display transform calls the private alias so it can't be broken.
    namespace = {
        "__name__": "__main__",
        "__file__": SOURCE,
        "__builtins__": __builtins__,
        "display": display,
        "__myelin_display__": display,
    }
    sys.argv = [SOURCE]

    try:
        exec(code, namespace)
    except SystemExit as err:
        return err.code if isinstance(err.code, int) else 0 if err.code is None else 1
    except BaseException as err:
        # Drop this frame so the traceback starts at the user's code.
        traceback.print_exception(type(err), err, err.__traceback__.tb_next)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
