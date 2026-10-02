# Windows process sandbox

## Prototype status

This backend does not yet satisfy Sandbox V1.1. `WRITE_RESTRICTED` permits `FILE_DELETE_CHILD` on outside directories that the user's existing ACL allows. Low integrity prevents deletion from normal Medium integrity directories, but does not protect outside Low integrity directories. A regression test reproduced an outside file deletion.

An independent `AccessCheck` probe confirmed that removing `WRITE_RESTRICTED` rejects deletion and data writes against an Everyone ACL without the capability. However, both token variants still allow those operations against a NULL DACL. Changing the read roots alone therefore cannot establish the unconditional outside write boundary required by SBX-003.

The helper checks this permission before preparing writable roots or starting a command. It rejects the current token. The backend reports `unavailable`, requiring explicit full access through the existing policy. It never silently executes the command directly.

PowerShell 5 and 7 initialization also remains unresolved. Passing NUL, Git, Python, Node, npm and pnpm checks does not establish acceptance while the deletion boundary fails.

## Current design

The Rust helper uses a write-restricted token with two synthetic SIDs:

- A fresh SID for each command grants writes to the run's private temp and, in `workspace-write`, the workspace.
- A fixed system object SID grants read/write/execute access to the Windows `Null`, `CNG` and `KsecDD` device objects, and query/traverse/object creation access to the global and current session `BaseNamedObjects` directories.

Neither `Everyone` nor the user's logon SID is added to the restricting list. Child processes inherit the restricted token and stay in a job object. Initialization errors never invoke direct execution.

## Development commands

```powershell
npm run sandbox:build
resources\sandbox\windows-sandbox.exe --check-enforcement
```

The enforcement check currently fails with access `0x40` (`FILE_DELETE_CHILD`). Device setup cannot resolve this failure.

```powershell
npm run sandbox:setup
```

Setup triggers Windows UAC and modifies only the five listed system objects' ACLs. It accepts no command or filesystem path arguments. A failed setup restores ACLs it already changed.

System object ACLs may reset on restart or session replacement. The helper checks these grants before preparing writable roots.

```powershell
resources\sandbox\windows-sandbox.exe --check-devices
npm run sandbox:remove-device-grants
```

The removal command requires UAC and removes only this helper's fixed SID grants.
