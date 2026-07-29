# Contributing to Myelin Notes

Thanks for your interest in contributing. Myelin Notes is a personal project I
build mostly for myself, so it's a small operation: I'm the only maintainer, and
I merge changes as I have time. This document explains how the project is
licensed, why I ask contributors to sign a CLA, and how to get a change merged.

## License: source-available, not "open source"

Myelin Notes is released under the **Functional Source License 1.1 with an Apache-2.0
future grant** (`FSL-1.1-ALv2`, see [LICENSE.md](./LICENSE.md)). In plain terms:

- You may **read, build, run, self-host, modify, and redistribute** the source
  for any purpose **except a Competing Use** — i.e. you can't use the Myelin Notes code
  to ship a commercial product or service that substitutes for Myelin Notes or for a
  paid product/service I offer.
- Every released version **automatically becomes Apache-2.0** on the second
  anniversary of its release. Nothing stays proprietary forever.

Because it is not an OSI-approved license, please describe Myelin Notes as
**"source-available"** or **"fair-source,"** not "open source."

## Why I ask for a CLA

Everything in the repo ships under the FSL today; there is no paid version yet.
But I may add one later, likely commercial licensing for non-personal use.

If that happens, a contribution needs to be shippable under both the FSL and
those commercial terms. That requires a broad license from you to me; without it,
your patch could only ever ship under the FSL, and I'd have to keep it out of any
paid build or rewrite it. So before your first pull request can be merged, you'll
be asked to agree to the **Contributor License Agreement** ([CLA.md](./CLA.md)).
It is a **license, not an assignment**: you keep the copyright to your work, and
you stay free to use it however you like. You sign once and it covers all future
contributions.

This means you'd be contributing to something I might eventually charge money for. If you'd rather not sign, you're still very welcome to open issues, file bug reports, and suggest ideas.

## Development setup

- This repo uses **`yarn`**, not npm.
- It's a **Tauri** app (Rust backend + React/TypeScript frontend). Run the app
  with `yarn tauri dev`.
- Lint/format with `yarn lint` (Biome); typecheck with `yarn typecheck`; run
  tests with `yarn test` (Vitest).

## Pull request process

1. Fork the repo and create a topic branch off the default branch.
2. Keep changes focused; match the surrounding code style.
3. Add or update tests for behavior changes, and make sure `yarn test`,
   `yarn typecheck`, and `yarn lint` pass.
4. Open the PR with a clear description of the change and its motivation.
5. Agree to the CLA when prompted.

For anything large or architectural, please open an issue first so we can agree
on the approach. Since this is a project I built around how I want to take notes,
I'm opinionated about direction and would rather say so before you've written the
code than after.

By submitting a contribution, you represent that it is your original work and
that you have the right to license it to me under the CLA.
