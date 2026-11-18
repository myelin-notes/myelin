"""Runs a user script with Jupyter-style rich display.

Each display is one stdout line: "\x1b]myelin;" + JSON {"data": {mime: value}, "metadata": {...}}
+ "\x07" (parsed by drain_reader in mod.rs). json.dumps escapes control characters, so the
payload can never contain the terminator or a newline.

Also imported by matplotlib as its backend via MPLBACKEND=module://_myelin_boot, so everything
outside the __main__ guard must stay cheap and side-effect free.
"""

import base64
import builtins
import json
import sys

_PREFIX = "\x1b]myelin;"
# Rows sent for a DataFrame; the card notes how many were left out.
_MAX_TABLE_ROWS = 1000

_REPR_METHODS = (
    ("text/html", "_repr_html_"),
    ("image/png", "_repr_png_"),
    ("image/jpeg", "_repr_jpeg_"),
    ("image/svg+xml", "_repr_svg_"),
    ("text/markdown", "_repr_markdown_"),
    ("text/latex", "_repr_latex_"),
)


def _emit(data, metadata):
    payload = json.dumps({"data": data, "metadata": metadata}, default=str)
    sys.stdout.write(_PREFIX + payload + "\x07\n")
    sys.stdout.flush()


def _figure_bundle(fig):
    import io

    buf = io.BytesIO()
    # 2x for HiDPI screens; the width metadata shows it at 1x CSS size.
    fig.savefig(buf, format="png", dpi=fig.dpi * 2, bbox_inches="tight")
    png = buf.getvalue()
    width = int.from_bytes(png[16:20], "big") // 2
    return (
        {"image/png": base64.b64encode(png).decode("ascii"), "text/plain": repr(fig)},
        {"image/png": {"width": width}},
    )


def _table_bundle(obj):
    frame = obj.to_frame() if type(obj).__name__ == "Series" else obj
    table = json.loads(
        frame.head(_MAX_TABLE_ROWS).to_json(orient="table", default_handler=str)
    )
    return (
        {"application/vnd.dataresource+json": table, "text/plain": repr(obj)},
        {"application/vnd.dataresource+json": {"totalRows": len(frame)}},
    )


def _bundle(obj):
    if isinstance(obj, type):
        return {"text/plain": repr(obj)}, {}
    module = type(obj).__module__ or ""
    name = type(obj).__name__
    if module.startswith("pandas") and name in ("DataFrame", "Series"):
        try:
            return _table_bundle(obj)
        except Exception:
            pass  # e.g. MultiIndex columns; fall through to pandas' HTML table.
    if module.startswith("plotly") and hasattr(obj, "to_html"):
        # Inlines the user's own plotly.js so the chart works offline and matches their version.
        return {"text/html": obj.to_html(include_plotlyjs=True, full_html=True)}, {}
    if module.startswith("matplotlib") and hasattr(obj, "savefig"):
        return _figure_bundle(obj)

    data, metadata = {}, {}
    method = getattr(obj, "_repr_mimebundle_", None)
    if callable(method):
        try:
            result = method()
            data, metadata = result if isinstance(result, tuple) else (result, {})
            data, metadata = dict(data or {}), dict(metadata or {})
        except Exception:
            pass
    for mime, attr in _REPR_METHODS:
        method = getattr(obj, attr, None)
        if mime in data or not callable(method):
            continue
        try:
            value = method()
        except Exception:
            continue
        if isinstance(value, tuple):
            value, metadata[mime] = value
        if value is not None:
            data[mime] = value
    for mime, value in data.items():
        if isinstance(value, bytes):
            binary = mime.startswith("image/") and mime != "image/svg+xml"
            data[mime] = base64.b64encode(value).decode("ascii") if binary else value.decode()
    data.setdefault("text/plain", repr(obj))
    return data, metadata


def display(*objs):
    for obj in objs:
        _emit(*_bundle(obj))


def show(*args, **kwargs):
    """matplotlib backend entry point for plt.show()."""
    from matplotlib._pylab_helpers import Gcf

    for manager in Gcf.get_all_fig_managers():
        display(manager.canvas.figure)
    Gcf.destroy_all()


if __name__ != "__main__":
    from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas  # noqa: F401


def _setup_plotly_io(pio):
    # The default renderer opens a browser tab from a script.
    pio.show = lambda fig, *args, **kwargs: display(fig)


def _setup_altair(alt):
    try:
        import vl_convert  # noqa: F401 -- bundles the Vega JS, so charts render offline

        alt.renderers.enable("html", template="inline")
    except Exception:
        alt.renderers.enable("html")
    alt.TopLevelMixin.show = lambda self, *args, **kwargs: display(self)


def _install_import_hooks(hooks):
    """Runs hooks[name](module) right after `name` is first imported, without importing it eagerly."""
    import importlib.abc
    import importlib.util

    class Finder(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path, target=None):
            hook = hooks.pop(name, None)
            if hook is None:
                return None
            spec = importlib.util.find_spec(name)
            if spec is None or spec.loader is None:
                return spec
            exec_module = spec.loader.exec_module

            def exec_and_hook(module):
                exec_module(module)
                try:
                    hook(module)
                except Exception:
                    pass

            spec.loader.exec_module = exec_and_hook
            return spec

    sys.meta_path.insert(0, Finder())


def _run(path):
    import ast

    with open(path, encoding="utf-8") as f:
        source = f.read()
    tree = ast.parse(source, path)
    last = None
    # Like Jupyter: the final bare expression is displayed unless it ends with `;`.
    if tree.body and isinstance(tree.body[-1], ast.Expr) and not source.rstrip().endswith(";"):
        last = tree.body.pop()
    scope = {"__name__": "__main__", "__file__": path, "__builtins__": builtins}
    exec(compile(tree, path, "exec"), scope)
    if last is not None:
        value = eval(compile(ast.Expression(last.value), path, "eval"), scope)
        if value is not None:
            display(value)
    # Figures never shown explicitly still render, like Jupyter's inline backend.
    if "matplotlib.pyplot" in sys.modules:
        show()


if __name__ == "__main__":
    import os

    os.environ["MPLBACKEND"] = "module://_myelin_boot"
    builtins.display = display
    _install_import_hooks({"plotly.io": _setup_plotly_io, "altair": _setup_altair})
    script = sys.argv[1]
    sys.argv = sys.argv[1:]
    try:
        _run(script)
    except SystemExit:
        raise
    except BaseException as error:
        import traceback

        # Hide bootstrap/ast frames; a SyntaxError has no user frame and prints just its location.
        tb = error.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename != script:
            tb = tb.tb_next
        traceback.print_exception(type(error), error, tb)
        sys.exit(1)
