# Contributing to Myelin Notes

Thanks for your interest in contributing. This document explains how Myelin Notes is
licensed, why we ask contributors to sign a CLA, and how to get a change merged.

## License: source-available, not "open source"

Myelin Notes is released under the **Functional Source License 1.1 with an Apache-2.0
future grant** (`FSL-1.1-ALv2`, see [LICENSE.md](./LICENSE.md)). In plain terms:

- You may **read, build, run, self-host, modify, and redistribute** the source
  for any purpose **except a Competing Use** — i.e. you can't use the Myelin Notes code
  to ship a commercial product or service that substitutes for Myelin Notes or for a
  paid product/service we offer.
- Every released version **automatically becomes Apache-2.0** on the second
  anniversary of its release. Nothing stays proprietary forever.

Because it is not an OSI-approved license, please describe Myelin Notes as
**"source-available"** or **"fair-source,"** not "open source."

## Why we ask for a CLA

Myelin Notes is offered under **two** licenses at once: the source-available FSL above
**and** separate paid commercial licenses (see the roadmap). For a contribution
to be included in *both*, we need you to grant us a broad license to your
contribution — otherwise your patch could only ship under the FSL, not in the
commercial builds our business depends on.

So before your first pull request can be merged, you'll be asked to agree to our
**Contributor License Agreement** ([CLA.md](./CLA.md)). It is a **license, not an
assignment**: you keep the copyright to your work. Agreement is collected
automatically the first time you open a PR, via the
[CLA Assistant](https://github.com/cla-assistant/cla-assistant) bot — you sign
once and it covers all future contributions.

If you'd rather not sign the CLA, you're still welcome to open issues, file bug
reports, and suggest ideas.

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
5. Agree to the CLA when the bot prompts you.

By submitting a contribution, you represent that it is your original work and
that you have the right to license it to us under the CLA.
