# Community changes and official releases

Public source contributions and official releases have separate approval steps.
Development builds never become updates merely because a contributor builds or merges code.
The community source repository is `e-nano/smartwall`. The internal development
workspace retains its private GitLab origin. The public repository currently has
no open-source licence; licence selection and official release approvals remain
pending. Source visibility alone does not grant an open-source licence.

## Public and private source

The community repository contains the local operator interface, local backend,
ESP32 firmware, update supervisor and the client for E-Nano's hosted service.
SmartWall Online is E-Nano's commercial service. Its portal frontend, server, MCP
server implementation, account management and hosting infrastructure remain private.
Public local code can be used to develop an independent compatible service.

Keep two repositories: the public local project and a private E-Nano service
repository with its own restricted CI and container registry. The current workspace
still contains private service files; keep them intact for internal development.
The new ignore rules prevent accidentally staging those currently untracked paths;
they are not a substitute for a private repository and backup. Do not publish this
workspace, migrate its Git history to the public remote, or make its GitLab origin public.

Create the initial community repository from an explicit source export:

```sh
python3 scripts/release/export-public.py /tmp/smartwall-community
python3 scripts/release/publication-audit.py --directory /tmp/smartwall-community
```

The destination must be new and outside this workspace. The export copies only
paths selected by `scripts/release/public-source.json`, excludes Git history, and
rejects symlinks and obvious private keys/tokens. A local review copy can use
`--preview` before a licence is selected. Source-only publication can use
`--source-only`; it grants no licence and cannot enable official releases. Regular
Checks use the source-only audit; the official-release workflow always requires
LICENSE and the protected approval environment. Review
the exported contents before initializing a fresh Git repository there. Future
public changes should be made in the community checkout and reviewed through PRs.

The publication audit rejects tracked files outside that allowlist, including
`platform/cloud-backend`, `platform/infra/gcp`, cloud build configuration, hosted
email setup, runtime data and private environment files. The local Docker context
also excludes the hosted service. Public workflows test only local code and publish
only the edge image and firmware; release metadata contains no hosted-service image.
Changes to the allowlist require the same maintainer review as release workflows.

## Owner setup before enabling publication

1. Choose the licence and add its complete text as `LICENSE`. Review the repository
   export for credentials, customer data and private infrastructure files. The
   audit is a limited source check, not a full credential review. Publish a clean
   export with fresh history; never make the mixed working repository public.
2. Maintain `e-nano/smartwall` from the reviewed export with `main` as its default branch. Enable issues,
   discussions and private vulnerability reporting. Keep the existing private
   GitLab origin separate.
3. Protect `main`: require passing Checks jobs, pull-request review, dismissal of stale
   approvals and no force-push/deletion. Configure CODEOWNERS with the actual maintainer
   team for `.github/`, `deploy/`, OTA code, the public-source allowlist and release scripts. Require code-owner review.
4. Protect `v*` tags so only release maintainers can create/update them.
5. Create the `official-release` Actions environment with required maintainer reviewers,
   prevent self-review and disable bypass. Limit it to protected release tags. Environment
   reviewers are configured in GitHub settings, not enforced by this YAML alone.
6. Generate an RSA-2048 signing key in controlled infrastructure. Store the private PEM
   only in the environment secret `RELEASE_SIGNING_KEY_PEM`. Publish the public PEM and
   verified fingerprint; put it in repository variable `FIRMWARE_PUBLIC_KEY_PEM`.
   Never store private signing keys in source, images, firmware or PR artifacts.
7. Set repository variable `OFFICIAL_RELEASES_ENABLED=true` only after these controls
   exist. Configure public GHCR package visibility for the `edge` image only.
   Release publication is disabled until this explicit setup is complete.

The signing key signs a release descriptor containing immutable image digests and
per-board firmware metadata. Signature algorithm is RSA PKCS#1 v1.5 / SHA-256 for both
Node/OpenSSL and ESP32 mbedTLS interoperability. The public key is compiled into each
firmware variant. Firmware signatures cover version, target, partition layout, size
and SHA-256 using the canonical bytes in `platform/shared/releases.js`.

## Candidate to stable

- Contributions enter through a pull request. Checks use hosted runners without
  publication credentials. Review code and run integration tests against disposable data.
- Test a candidate on both boards and Linux AMD64/ARM64 installations. Include wrong-board
  rejection, altered signature, oversized image, failed boot, power interruption,
  database migration failure and recovery, bin discovery and offline behavior.
- Create a protected `vX.Y.Z-beta.N` tag for opt-in beta testing. Stable releases use
  `vX.Y.Z`; the workflow verifies the tag is on main's history.
- Approve the release job. It validates code, builds each firmware variant, builds
  multi-architecture edge images, emits SBOM/provenance, signs descriptors and
  publishes versioned assets. The publishing job has a second environment approval gate.
- Review the published candidate and its release notes. Stable publication requires a
  new stable tag and explicit approval. No automatic promotion from beta to stable.

The stable feed is `https://github.com/e-nano/smartwall/releases/latest/download/release.json`
with detached signature `release.json.sig`. GitHub prereleases do not become that stable
feed. Beta users can pin a particular beta release URL; a moving beta feed and percentage
fleet rollouts are not implemented yet. Development builds stay local or in CI artifacts.

Do not overwrite an existing version's image/binary/metadata. A corrected release gets
a new version. Source changes should update `.firmware-version` for development; official
builds use the protected tag's version for both software and firmware.

Community forks may use their own registry, release URL and signing key. Their users
explicitly enroll that public key. They do not gain authority to publish official updates.

## Required first-release checks

- Approved licence, maintainers, release environment and signing-key custody.
- Dependency/security scan and review of workflow action pins.
- Container smoke tests on both supported architectures, including persistent-volume recovery.
- Physical boot rollback and signed OTA tests on DevKit and integrated Rev 0.2.
- A tested USB bootstrap/recovery procedure for existing 0.3.x bins.
- Restore rehearsal for the local SQLite database.
- Confirm that source archives, CI artifacts and images contain no private hosted-service code.

The current supervisor handles edge containers only. Percentage canaries,
publisher-key rotation and hardware secure boot are subsequent features. The
private hosted service has a separate internal deployment and backup process.
