# Windows Process Sandbox V1.2

Status: complete.

Enforcement: `partial`.

## Security target

| Mode | Workspace | Private temp | Ordinary files outside the workspace |
| --- | --- | --- | --- |
| `workspace-write` | Read, create, modify, delete | Read, create, modify, delete | Read allowed; writes and deletes denied |
| `read-only` | Read | Read; no write grant | Read allowed; writes and deletes denied |

The filesystem guarantee covers ordinary user files with normal Medium integrity protection. Arbitrary security descriptors, outside Low integrity directories with ambient parent-delete authority, and NULL DACLs fall outside this guarantee. Reads, network access, and process visibility remain available.

`WindowsSandboxBackend.support()` caches the real enforcement probe result per backend instance: success reports `partial`, and any launch error, failed check, or timeout reports `unavailable`. Initialization errors become tool errors. Unavailable support requires explicit full access through the existing policy; only `full-access` selects `DirectExecutionBackend`.

## Shell execution

Windows Shell commands use PowerShell 7 in every permission mode, with native Windows paths and launcher-controlled cwd. `ShellRuntime` selects the executable, arguments, environment and working directory independently of sandbox permissions. Restricted launches pass the executable and argv to Rust; full-access launches use the same runtime through Node. The existing internal `bash` tool ID remains compatible with saved settings and transcripts, while its label, description and prompt contributions identify Shell / PowerShell 7.

The invocation is `pwsh.exe -NoLogo -NoProfile -NonInteractive -Mta -Command <command>`. The additional `-Mta` flag is required by the current isolated desktop and restricted token: the default STA pipeline crashes during `WaitHandle.WaitOne`, while MTA runs with the same security boundary. A missing `pwsh.exe` produces `shell_runtime_unavailable`, with no alternate shell. PowerShell 7 streams use UTF-8; the prelude sets native-pipeline encoding and initializes console encoding in FullLanguage sessions. Read-only sessions can enter ConstrainedLanguage because their temporary script-write probe is denied, so the prelude respects that language mode.

Native Read, Write, Edit, Find and Grep implementations remain independent of Shell. Commands receive separate stdout, stderr and exit-code fields. Launch failures have explicit `workspace_root_acl_failed`, `sandbox_policy_init_failed` or `process_spawn_failed` codes and no command exit code. A command that exits 125 remains a command failure.

Workspace ACL inspection skips only child paths returning `ERROR_ACCESS_DENIED`. Skipped subtrees receive no writable capability grant, keep their existing access restrictions and are skipped during cleanup traversal. Workspace-root ACL failures remain fatal in both modes; private-temp initialization and ACL mutation failures remain fatal. Existing saved descriptors are still restored.

## Enforcement

The Rust helper uses a Low integrity `WRITE_RESTRICTED` token with two synthetic SIDs:

- A fresh capability SID for each command grants access to that command's writable roots.
- A fixed system object SID grants access to the Windows `Null`, `CNG`, and `KsecDD` devices and the global and current session `BaseNamedObjects` directories.

Neither Everyone nor the user's logon SID is added to the restricting list. Windows requires both the ordinary SID check and the restricting SID check to pass. The parent directory's `FILE_DELETE_CHILD` permission provides an additional delete path, so each authorized directory combines:

- A capability allow for read, write, execute, `DELETE`, and `FILE_DELETE_CHILD`.
- An Everyone deny for exactly `FILE_DELETE_CHILD`, with `CONTAINER_INHERIT_ACE` only.
- An owner-rights allow for `READ_CONTROL`.
- A Low integrity no-write-up label.

The deny never inherits to files. It is inserted separately in the in-memory ACL to avoid merging with a user's existing Everyone deny. The complete DACL and label are applied together through the verified file handle, with no intermediate capability grant.

Existing objects keep their saved security descriptors, including inheritance and protection flags, for restoration. New objects lose the exact sandbox capability, owner-rights, and directory-delete deny ACEs, and receive Medium integrity. Cleanup preserves pre-existing Everyone ACEs, including an identical inherited directory-delete deny.

The helper skips reparse points when granting and restoring ACLs. Existing files with multiple hard links are skipped to avoid granting their external aliases. Roots are pinned while the command runs, and a mutex serializes ACL scopes. Child and grandchild processes inherit the token and remain in a `KILL_ON_JOB_CLOSE` Job Object. Cancellation terminates the process tree before ACL restoration.

The restricted-token mechanism is described by [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens). The directory-only delete deny and partial boundary follow the same approach documented by [DSH's Windows ACL backend](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-windows-acl/README.md).

## Runtime probe and regression coverage

`--check-enforcement` creates a workspace, a private temp directory, an outside directory, and a workspace junction to the outside directory. It launches the real helper child directly through the generic restricted executable-and-argv launcher in both modes and checks actual filesystem operations.

The probe requires workspace and private-temp create/modify/delete to succeed in `workspace-write`, outside and junction-target writes/deletes to return permission denied, and all filesystem mutations to fail in `read-only`. It exits zero only after both modes pass and the ACL scope restores successfully.

Permanent regressions cover PowerShell cwd, UTF-8, quoting, missing runtime, child ACL access denial, fatal root ACL denial, command exit 125, relative outside paths, junction deletion, symbolic links, directory-only deny inheritance, file FullControl opens, exact ACE cleanup, descriptor restoration, initialization rollback, cancellation, private-temp isolation, and support caching. Harness coverage verifies that workspace-write Shell executes without a full-access approval. Node, npm, pnpm, and Python descendants are checked for outside write and delete denial; Git initialization and status run in the workspace.

## Known boundaries

- Hard links alias file objects, so path-based isolation cannot provide an unconditional boundary for every alias or custom security descriptor.
- Files with special AppContainer ACLs can remain inaccessible.
- FullControl directory opens are denied while the grant is active because that mask includes `FILE_DELETE_CHILD`. Ordinary file opens and deletes using an object's own `DELETE` permission continue to work.
- PowerShell runs in MTA mode. Commands requiring STA-specific COM behavior are outside this Shell contract.
- Cleanup failures are reported, and abrupt helper termination can leave ACL residue.

## Development commands

```powershell
npm run sandbox:build
resources\sandbox\windows-sandbox.exe --check-enforcement
resources\sandbox\windows-sandbox.exe --check-devices
npm test
cargo test --locked --manifest-path native/windows-sandbox/Cargo.toml
```

PowerShell 7 must be on PATH. Python regressions require a real installed interpreter. If `python` resolves to a Windows Store alias, set `SANDBOX_TEST_PYTHON` to the interpreter's absolute path before running tests. Symbolic-link fixtures are skipped when Developer Mode or `SeCreateSymbolicLinkPrivilege` is unavailable; junction checks always run.

```powershell
npm run sandbox:setup
npm run sandbox:remove-device-grants
```

Setup triggers UAC and modifies only the five listed system objects' ACLs. Setup accepts no command or filesystem-path arguments and rolls back earlier changes on failure. System grants can reset on restart or session replacement; the helper checks them before preparing writable roots.

## Source layout

| File | Role |
| --- | --- |
| `main.rs` | Entry point and exit status |
| `sandbox.rs` | Request validation, ACL scope orchestration, and workspace lock |
| `token.rs` | Restricted token and integrity initialization |
| `acl.rs` | Win32 ACL operations, grants, exact cleanup, restoration, and ACL regressions |
| `process.rs` | Stdio, process creation, cancellation, and exit handling |
| `job.rs` | Job Object confinement |
| `objects.rs` | Desktop, window station, devices, and object namespaces |
| `probe.rs` | Real child filesystem enforcement probe |
| `win32.rs` | Handle ownership, local allocations, strings, and Win32 error results |
