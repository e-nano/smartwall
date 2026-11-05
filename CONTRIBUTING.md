# Contributing to SmartWall

Use issues to report reproducible problems and propose changes, and pull requests
for code, documentation and hardware support. Include the affected board, software
version and steps to reproduce. Remove credentials and private inventory from reports.

Contributions here cover local software, firmware and the hosted-service client.
E-Nano's online portal, server and infrastructure remain private.

Run `npm run typecheck` and the relevant backend/frontend Node tests from `platform/`.
Run supervisor and publication-boundary tests with
`python3 -m unittest discover -s deploy/tests -v`. Firmware changes must compile for
both PlatformIO environments; document which physical boards were actually tested.
Respect local AGENTS.md instructions, including any restriction on npm builds.

Maintainers review contributions before merging. A merge does not publish an update.
Official releases require separate maintainer approval as described in
[RELEASING.md](docs/RELEASING.md). Include migration and recovery considerations for
persistent-data changes, and adversarial tests for authentication/update changes.

The owner must choose and add `LICENSE` before the first official release. Until then,
this preparation does not grant a new open-source licence to existing material.
