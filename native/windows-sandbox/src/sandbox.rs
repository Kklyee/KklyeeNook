use std::collections::HashSet;
use std::ffi::{c_void, OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, PathBuf, Prefix};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::NtOpenDirectoryObject;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::Cryptography::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::Console::*;
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::StationsAndDesktops::*;
use windows_sys::Win32::System::SystemInformation::*;
use windows_sys::Win32::System::SystemServices::{
    ACCESS_ALLOWED_ACE_TYPE, SECURITY_DESCRIPTOR_REVISION, SE_GROUP_INTEGRITY,
};
use windows_sys::Win32::System::Threading::*;

type Result<T> = std::result::Result<T, String>;
type FileId = (u32, u32, u32);

const SYSTEM_SID: &str = "S-1-5-21-2984733901-1447396327-1942789461-1";
const DEVICES: [&str; 3] = [
    r"\\?\GLOBALROOT\Device\Null",
    r"\\?\GLOBALROOT\Device\CNG",
    r"\\?\GLOBALROOT\Device\KsecDD",
];

unsafe fn open_device(path: &str, access: u32) -> Result<Handle> {
    Handle::new(
        CreateFileW(
            wide(path).as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        ),
        &format!("device {path} open"),
    )
}

unsafe fn setup_devices(remove: bool) -> Result<u32> {
    let principal = sid(SYSTEM_SID)?;
    let mut targets = Vec::new();
    for path in DEVICES {
        targets.push((
            open_device(path, READ_CONTROL | WRITE_DAC)?,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE,
        ));
    }
    targets.push((open_global_directory(READ_CONTROL | WRITE_DAC)?, 0xf));
    targets.push((open_object_directory(READ_CONTROL | WRITE_DAC)?, 0xf));
    let mut saved = Vec::new();
    let result = (|| {
        for (device, access) in targets {
            let mut original = null_mut();
            status(
                GetSecurityInfo(
                    device.0,
                    SE_KERNEL_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    &mut original,
                ),
                "system object ACL read",
            )?;
            let original = Local(original);
            let acl = dacl(original.0)?;
            let updated = add_entries(&[], acl)?;
            let acl = updated.0.cast();
            remove_principal(acl, principal.0, None)?;
            let grant;
            let acl = if remove || access == 0 {
                acl
            } else {
                grant = add_entries(&[entry(principal.0, access, 0)], acl)?;
                grant.0.cast()
            };
            saved.push((device, original));
            set_security(
                saved.last().unwrap().0 .0,
                acl,
                null_mut(),
                DACL_SECURITY_INFORMATION,
            )?;
        }
        Ok(0)
    })();
    if result.is_err() {
        for (device, original) in saved.iter().rev() {
            check(
                SetKernelObjectSecurity(device.0, DACL_SECURITY_INFORMATION, original.0),
                "system object ACL rollback",
            )?;
        }
    }
    result
}

unsafe fn check_devices(token: HANDLE) -> Result<()> {
    check(ImpersonateLoggedOnUser(token), "device access check")?;
    let result = DEVICES
        .into_iter()
        .try_for_each(|path| open_device(path, GENERIC_READ | GENERIC_WRITE).map(|_| ()))
        .and_then(|_| open_global_directory(0xf).map(|_| ()))
        .and_then(|_| open_object_directory(0xf).map(|_| ()));
    check(RevertToSelf(), "device access check cleanup")?;
    result.map_err(|error| {
        format!("{error}; run Windows sandbox setup with administrator permissions")
    })
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

fn check(value: i32, stage: &str) -> Result<()> {
    if value == 0 {
        Err(format!(
            "{stage} failed: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

fn status(value: u32, stage: &str) -> Result<()> {
    if value != 0 {
        Err(format!(
            "{stage} failed: {}",
            std::io::Error::from_raw_os_error(value as i32)
        ))
    } else {
        Ok(())
    }
}

struct Handle(HANDLE);

impl Handle {
    fn new(value: HANDLE, stage: &str) -> Result<Self> {
        if value.is_null() || value == INVALID_HANDLE_VALUE {
            Err(format!(
                "{stage} failed: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(Self(value))
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

struct Local(*mut c_void);

impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

unsafe fn sid(value: &str) -> Result<Local> {
    let mut pointer = null_mut();
    check(
        ConvertStringSidToSidW(wide(value).as_ptr(), &mut pointer),
        "SID creation",
    )?;
    Ok(Local(pointer))
}

unsafe fn label(value: &str) -> Result<Local> {
    let mut pointer = null_mut();
    check(
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(value).as_ptr(),
            SDDL_REVISION_1,
            &mut pointer,
            null_mut(),
        ),
        "integrity label creation",
    )?;
    Ok(Local(pointer))
}

unsafe fn dacl(descriptor: PSECURITY_DESCRIPTOR) -> Result<*mut ACL> {
    let (mut present, mut defaulted, mut acl) = (0, 0, null_mut());
    check(
        GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted),
        "DACL inspection",
    )?;
    if acl.is_null() {
        Err("Null DACL is unsupported".into())
    } else {
        Ok(acl)
    }
}

unsafe fn sacl(descriptor: PSECURITY_DESCRIPTOR) -> Result<*mut ACL> {
    let (mut present, mut defaulted, mut acl) = (0, 0, null_mut());
    check(
        GetSecurityDescriptorSacl(descriptor, &mut present, &mut acl, &mut defaulted),
        "integrity label inspection",
    )?;
    Ok(acl)
}

unsafe fn descriptor(acl: *mut ACL, label: *mut ACL) -> Result<SECURITY_DESCRIPTOR> {
    let mut value: SECURITY_DESCRIPTOR = zeroed();
    check(
        InitializeSecurityDescriptor(
            (&mut value as *mut SECURITY_DESCRIPTOR).cast(),
            SECURITY_DESCRIPTOR_REVISION,
        ),
        "security descriptor creation",
    )?;
    check(
        SetSecurityDescriptorDacl((&mut value as *mut SECURITY_DESCRIPTOR).cast(), 1, acl, 0),
        "DACL preparation",
    )?;
    check(
        SetSecurityDescriptorSacl((&mut value as *mut SECURITY_DESCRIPTOR).cast(), 1, label, 0),
        "integrity preparation",
    )?;
    Ok(value)
}

unsafe fn set_security(handle: HANDLE, acl: *mut ACL, label: *mut ACL, flags: u32) -> Result<()> {
    let mut value = descriptor(acl, label)?;
    check(
        SetKernelObjectSecurity(
            handle,
            flags,
            (&mut value as *mut SECURITY_DESCRIPTOR).cast(),
        ),
        "ACL preparation",
    )
}

unsafe fn get_security(handle: HANDLE) -> Result<Local> {
    let mut value = null_mut();
    status(
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            &mut value,
        ),
        "ACL read",
    )?;
    Ok(Local(value))
}

unsafe fn entry(principal: PSID, access: u32, inheritance: u32) -> EXPLICIT_ACCESS_W {
    let mut value: EXPLICIT_ACCESS_W = zeroed();
    value.grfAccessPermissions = access;
    value.grfAccessMode = GRANT_ACCESS;
    value.grfInheritance = inheritance;
    value.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    value.Trustee.ptstrName = principal.cast();
    value
}

unsafe fn add_entries(entries: &[EXPLICIT_ACCESS_W], original: *mut ACL) -> Result<Local> {
    let mut value = null_mut();
    status(
        SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), original, &mut value),
        "ACL grant",
    )?;
    Ok(Local(value.cast()))
}

unsafe fn remove_principal(acl: *mut ACL, principal: PSID, mask: Option<u32>) -> Result<bool> {
    let mut removed = false;
    for index in (0..(*acl).AceCount as u32).rev() {
        let mut pointer = null_mut();
        check(GetAce(acl, index, &mut pointer), "ACE inspection")?;
        if (*pointer.cast::<ACE_HEADER>()).AceType as u32 != ACCESS_ALLOWED_ACE_TYPE {
            continue;
        }
        let ace = &*pointer.cast::<ACCESS_ALLOWED_ACE>();
        if EqualSid((&ace.SidStart as *const u32).cast_mut().cast(), principal) != 0
            && mask.is_none_or(|mask| mask == ace.Mask)
        {
            check(DeleteAce(acl, index), "ACL revocation")?;
            removed = true;
        }
    }
    Ok(removed)
}

fn open(path: &Path, access: u32, pin: bool) -> Result<File> {
    OpenOptions::new()
        .access_mode(access)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | if pin { 0 } else { FILE_SHARE_DELETE })
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("ACL open {} failed: {error}", path.display()))
}

unsafe fn information(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION> {
    let mut value = zeroed();
    check(
        GetFileInformationByHandle(file.as_raw_handle(), &mut value),
        "file identity inspection",
    )?;
    Ok(value)
}

fn identity(info: &BY_HANDLE_FILE_INFORMATION) -> FileId {
    (
        info.dwVolumeSerialNumber,
        info.nFileIndexHigh,
        info.nFileIndexLow,
    )
}

unsafe fn verify_path(file: &File, expected: &Path) -> Result<()> {
    let length = GetFinalPathNameByHandleW(
        file.as_raw_handle(),
        null_mut(),
        0,
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
    );
    if length == 0 {
        return Err(format!(
            "canonicalization failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut buffer = vec![0; length as usize + 1];
    let actual = GetFinalPathNameByHandleW(
        file.as_raw_handle(),
        buffer.as_mut_ptr(),
        buffer.len() as u32,
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
    );
    if actual == 0 || actual as usize >= buffer.len() {
        return Err("canonical path changed".into());
    }
    let path = PathBuf::from(OsString::from_wide(&buffer[..actual as usize]));
    if path != expected {
        return Err(format!("filesystem path changed: {}", expected.display()));
    }
    Ok(())
}

struct Security {
    capability: Local,
    _device: Local,
    owner_rights: Local,
    low_label: Local,
    medium_label: Local,
    user: Vec<u32>,
    token: Handle,
}

impl Security {
    unsafe fn validate_filesystem_restrictions(&self) -> Result<()> {
        let everyone = sid("S-1-1-0")?;
        let acl = add_entries(&[entry(everyone.0, FILE_ALL_ACCESS, 0)], null_mut())?;
        let mut value = descriptor(acl.0.cast(), sacl(self.low_label.0)?)?;
        let pointer = (&mut value as *mut SECURITY_DESCRIPTOR).cast();
        let user = self.user.as_ptr().cast_mut().cast();
        check(
            SetSecurityDescriptorOwner(pointer, user, 0),
            "boundary check owner",
        )?;
        check(
            SetSecurityDescriptorGroup(pointer, user, 0),
            "boundary check group",
        )?;
        let mut impersonation = null_mut();
        check(
            DuplicateToken(self.token.0, SecurityImpersonation, &mut impersonation),
            "boundary check token",
        )?;
        let impersonation = Handle(impersonation);
        let mapping = GENERIC_MAPPING {
            GenericRead: FILE_GENERIC_READ,
            GenericWrite: FILE_GENERIC_WRITE,
            GenericExecute: FILE_GENERIC_EXECUTE,
            GenericAll: FILE_ALL_ACCESS,
        };
        for access in [
            DELETE,
            FILE_DELETE_CHILD,
            WRITE_DAC,
            WRITE_OWNER,
            FILE_WRITE_DATA,
        ] {
            let mut privileges: PRIVILEGE_SET = zeroed();
            let mut length = size_of::<PRIVILEGE_SET>() as u32;
            let (mut granted, mut allowed) = (0, 0);
            check(
                AccessCheck(
                    pointer,
                    impersonation.0,
                    access,
                    &mapping,
                    &mut privileges,
                    &mut length,
                    &mut granted,
                    &mut allowed,
                ),
                "filesystem boundary check",
            )?;
            if allowed != 0 {
                return Err(format!(
                    "restricted token cannot enforce the filesystem boundary (access 0x{access:x})"
                ));
            }
        }
        Ok(())
    }

    unsafe fn new() -> Result<Self> {
        let mut random = [0u32; 4];
        if BCryptGenRandom(
            null_mut(),
            random.as_mut_ptr().cast(),
            size_of_val(&random) as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        ) < 0
        {
            return Err("sandbox identity generation failed".into());
        }
        let capability = sid(&format!(
            "S-1-5-21-{}-{}-{}-{}",
            random[0], random[1], random[2], random[3]
        ))?;
        let owner_rights = sid("S-1-3-4")?;
        let device = sid(SYSTEM_SID)?;
        let integrity_sid = sid("S-1-16-4096")?;
        let low_label = label("S:(ML;OICI;NW;;;LW)")?;
        let medium_label = label("S:(ML;OICI;NW;;;ME)")?;
        let mut original = null_mut();
        check(
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
                &mut original,
            ),
            "token open",
        )?;
        let original = Handle(original);
        let mut needed = 0;
        GetTokenInformation(original.0, TokenUser, null_mut(), 0, &mut needed);
        let mut buffer = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
        check(
            GetTokenInformation(
                original.0,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ),
            "token user inspection",
        )?;
        let user_sid = (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid;
        let length = GetLengthSid(user_sid);
        let mut user = vec![0u32; (length as usize).div_ceil(4)];
        check(
            CopySid(length, user.as_mut_ptr().cast(), user_sid),
            "token user copy",
        )?;
        let restrictions = [capability.0, device.0].map(|principal| SID_AND_ATTRIBUTES {
            Sid: principal,
            Attributes: 0,
        });
        let mut token = null_mut();
        check(
            CreateRestrictedToken(
                original.0,
                DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
                0,
                null(),
                0,
                null(),
                restrictions.len() as u32,
                restrictions.as_ptr(),
                &mut token,
            ),
            "restricted token creation",
        )?;
        let token = Handle(token);
        let mandatory = TOKEN_MANDATORY_LABEL {
            Label: SID_AND_ATTRIBUTES {
                Sid: integrity_sid.0,
                Attributes: SE_GROUP_INTEGRITY as u32,
            },
        };
        check(
            SetTokenInformation(
                token.0,
                TokenIntegrityLevel,
                (&mandatory as *const TOKEN_MANDATORY_LABEL).cast(),
                (size_of::<TOKEN_MANDATORY_LABEL>() as u32) + GetLengthSid(integrity_sid.0),
            ),
            "token integrity initialization",
        )?;
        let disabled = 0u32;
        check(
            SetTokenInformation(
                token.0,
                TokenVirtualizationEnabled,
                (&disabled as *const u32).cast(),
                4,
            ),
            "token virtualization initialization",
        )?;
        let defaults = add_entries(
            &[
                entry(capability.0, GENERIC_ALL, 0),
                entry(user.as_mut_ptr().cast(), GENERIC_ALL, 0),
                entry(owner_rights.0, READ_CONTROL, 0),
            ],
            null_mut(),
        )?;
        let defaults_info = TOKEN_DEFAULT_DACL {
            DefaultDacl: defaults.0.cast(),
        };
        check(
            SetTokenInformation(
                token.0,
                TokenDefaultDacl,
                (&defaults_info as *const TOKEN_DEFAULT_DACL).cast(),
                size_of::<TOKEN_DEFAULT_DACL>() as u32,
            ),
            "token default ACL initialization",
        )?;
        let mut token_descriptor = descriptor(defaults.0.cast(), sacl(low_label.0)?)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: (&mut token_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
            bInheritHandle: 0,
        };
        let mut primary = null_mut();
        check(
            DuplicateTokenEx(
                token.0,
                TOKEN_ALL_ACCESS,
                &attributes,
                SecurityImpersonation,
                TokenPrimary,
                &mut primary,
            ),
            "restricted token security initialization",
        )?;
        let token = Handle(primary);
        Ok(Self {
            capability,
            _device: device,
            owner_rights,
            low_label,
            medium_label,
            user,
            token,
        })
    }

    unsafe fn label_handle(&self, path: &Path, file: &File, original: *mut ACL) -> Result<File> {
        let temporary = add_entries(
            &[entry(self.user.as_ptr().cast_mut().cast(), WRITE_OWNER, 0)],
            original,
        )?;
        set_security(
            file.as_raw_handle(),
            temporary.0.cast(),
            null_mut(),
            DACL_SECURITY_INFORMATION,
        )?;
        let result = open(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER, false).and_then(|full| {
            verify_path(&full, path)?;
            if identity(&information(file)?) != identity(&information(&full)?) {
                return Err("file identity changed during ACL preparation".into());
            }
            Ok(full)
        });
        if result.is_err() {
            set_security(
                file.as_raw_handle(),
                original,
                null_mut(),
                DACL_SECURITY_INFORMATION,
            )?;
        }
        result
    }
}

struct SavedSecurity {
    file: File,
    descriptor: Local,
    id: FileId,
}

struct AclScope<'a> {
    security: &'a Security,
    roots: Vec<PathBuf>,
    saved: Vec<SavedSecurity>,
}

impl AclScope<'_> {
    unsafe fn grant_tree(&mut self, path: &Path, cancelled: &AtomicBool) -> Result<()> {
        if cancelled.load(Ordering::Acquire) {
            return Err("execution cancelled".into());
        }
        let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        let file = open(path, READ_CONTROL | WRITE_DAC, false)?;
        let info = information(&file)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        verify_path(&file, path)?;
        if !metadata.is_dir() && info.nNumberOfLinks > 1 {
            return Ok(());
        }
        let original = get_security(file.as_raw_handle())?;
        let original_dacl = dacl(original.0)?;
        let inheritance = if metadata.is_dir() {
            SUB_CONTAINERS_AND_OBJECTS_INHERIT
        } else {
            0
        };
        let grant = FILE_GENERIC_READ
            | FILE_GENERIC_WRITE
            | FILE_GENERIC_EXECUTE
            | DELETE
            | if metadata.is_dir() {
                FILE_DELETE_CHILD
            } else {
                0
            };
        let updated = add_entries(
            &[
                entry(self.security.capability.0, grant, inheritance),
                entry(self.security.owner_rights.0, READ_CONTROL, inheritance),
            ],
            original_dacl,
        )?;
        self.saved.push(SavedSecurity {
            file,
            descriptor: original,
            id: identity(&info),
        });
        let record = self.saved.last_mut().unwrap();
        record.file = self
            .security
            .label_handle(path, &record.file, original_dacl)?;
        set_security(
            record.file.as_raw_handle(),
            updated.0.cast(),
            sacl(self.security.low_label.0)?,
            DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
        )?;
        if metadata.is_dir() {
            for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
                self.grant_tree(&entry.map_err(|error| error.to_string())?.path(), cancelled)?;
            }
        }
        Ok(())
    }

    unsafe fn strip_new_tree(&self, path: &Path, existing: &HashSet<FileId>) -> Result<()> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        let file = open(path, READ_CONTROL | WRITE_DAC, false)?;
        let info = information(&file)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        verify_path(&file, path)?;
        if metadata.is_dir() {
            for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
                self.strip_new_tree(&entry.map_err(|error| error.to_string())?.path(), existing)?;
            }
        }
        if existing.contains(&identity(&info)) {
            return Ok(());
        }
        let original = get_security(file.as_raw_handle())?;
        let acl = dacl(original.0)?;
        if remove_principal(acl, self.security.capability.0, None)? {
            remove_principal(acl, self.security.owner_rights.0, Some(READ_CONTROL))?;
            let full = self.security.label_handle(path, &file, acl)?;
            set_security(
                full.as_raw_handle(),
                acl,
                sacl(self.security.medium_label.0)?,
                DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
            )?;
        }
        Ok(())
    }

    unsafe fn restore(&mut self) -> Result<()> {
        let existing: HashSet<_> = self.saved.iter().map(|record| record.id).collect();
        let mut errors = Vec::new();
        for root in &self.roots {
            if let Err(error) = self.strip_new_tree(root, &existing) {
                errors.push(error);
            }
        }
        self.roots.clear();
        while let Some(record) = self.saved.pop() {
            if SetKernelObjectSecurity(
                record.file.as_raw_handle(),
                DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
                record.descriptor.0,
            ) == 0
            {
                let error = GetLastError();
                if error != ERROR_DELETE_PENDING && error != ERROR_FILE_NOT_FOUND {
                    errors.push(format!(
                        "ACL restore failed: {}",
                        std::io::Error::from_raw_os_error(error as i32)
                    ));
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

impl Drop for AclScope<'_> {
    fn drop(&mut self) {
        unsafe {
            if let Err(error) = self.restore() {
                eprintln!("Sandbox {error}");
            }
        }
    }
}

struct WorkspaceLock(Handle);

impl WorkspaceLock {
    unsafe fn acquire(cancelled: &AtomicBool) -> Result<Self> {
        let handle = Handle::new(
            CreateMutexW(null(), 0, wide("Local\\KklyeeNookWindowsSandbox").as_ptr()),
            "workspace lock",
        )?;
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err("execution cancelled".into());
            }
            match WaitForSingleObject(handle.0, 50) {
                WAIT_OBJECT_0 | WAIT_ABANDONED => return Ok(Self(handle)),
                WAIT_TIMEOUT => {}
                _ => {
                    return Err(format!(
                        "workspace lock failed: {}",
                        std::io::Error::last_os_error()
                    ))
                }
            }
        }
    }
}

impl Drop for WorkspaceLock {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.0 .0);
        }
    }
}

struct Desktop(HDESK);

unsafe fn open_object_directory(access: u32) -> Result<Handle> {
    let mut session = 0;
    check(
        ProcessIdToSessionId(GetCurrentProcessId(), &mut session),
        "object namespace session lookup",
    )?;
    let path = format!(r"\Sessions\{session}\BaseNamedObjects");
    open_directory(&path, access)
}

unsafe fn open_global_directory(access: u32) -> Result<Handle> {
    open_directory(r"\BaseNamedObjects", access)
}

unsafe fn open_directory(path: &str, access: u32) -> Result<Handle> {
    let mut path = wide(path);
    let name = UNICODE_STRING {
        Length: ((path.len() - 1) * 2) as u16,
        MaximumLength: (path.len() * 2) as u16,
        Buffer: path.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        ObjectName: &name,
        Attributes: 0x40,
        ..zeroed()
    };
    let mut handle = null_mut();
    let code = NtOpenDirectoryObject(&mut handle, access, &attributes);
    if code < 0 {
        return Err(format!("object namespace open failed: {code:#x}"));
    }
    Ok(Handle(handle))
}

impl Drop for Desktop {
    fn drop(&mut self) {
        unsafe {
            CloseDesktop(self.0);
        }
    }
}

struct Station<'a> {
    handle: HWINSTA,
    security: &'a Security,
    granted: bool,
}

impl Station<'_> {
    unsafe fn access(&mut self, grant: bool) -> Result<()> {
        let flags = DACL_SECURITY_INFORMATION;
        let mut needed = 0;
        GetUserObjectSecurity(self.handle, &flags, null_mut(), 0, &mut needed);
        let mut original = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
        check(
            GetUserObjectSecurity(
                self.handle,
                &flags,
                original.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ),
            "window station ACL read",
        )?;
        let mut acl = dacl(original.as_mut_ptr().cast())?;
        let updated;
        if grant {
            updated = add_entries(
                &[entry(self.security.capability.0, 0x037f | READ_CONTROL, 0)],
                acl,
            )?;
            acl = updated.0.cast();
        } else {
            remove_principal(acl, self.security.capability.0, None)?;
        }
        let mut value = descriptor(acl, null_mut())?;
        check(
            SetUserObjectSecurity(
                self.handle,
                &flags,
                (&mut value as *mut SECURITY_DESCRIPTOR).cast(),
            ),
            "window station ACL preparation",
        )?;
        self.granted = grant;
        Ok(())
    }
}

impl Drop for Station<'_> {
    fn drop(&mut self) {
        unsafe {
            if self.granted {
                if let Err(error) = self.access(false) {
                    eprintln!("Sandbox {error}");
                }
            }
            CloseWindowStation(self.handle);
        }
    }
}

struct Job(Handle);

impl Job {
    unsafe fn new() -> Result<Self> {
        let handle = Handle::new(CreateJobObjectW(null(), null()), "job creation")?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        check(
            SetInformationJobObject(
                handle.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of_val(&limits) as u32,
            ),
            "job initialization",
        )?;
        Ok(Self(handle))
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            TerminateJobObject(self.0 .0, 125);
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = zeroed();
            while QueryInformationJobObject(
                self.0 .0,
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of_val(&info) as u32,
                null_mut(),
            ) != 0
                && info.ActiveProcesses != 0
            {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

struct Process {
    handle: Handle,
    thread: Handle,
}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe {
            TerminateProcess(self.handle.0, 125);
            WaitForSingleObject(self.handle.0, INFINITE);
        }
    }
}

struct Attributes {
    _buffer: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl Attributes {
    unsafe fn new(handles: &[HANDLE]) -> Result<Self> {
        let mut bytes = 0;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes);
        let mut buffer = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let pointer = buffer.as_mut_ptr().cast();
        check(
            InitializeProcThreadAttributeList(pointer, 1, 0, &mut bytes),
            "handle list creation",
        )?;
        let value = Self {
            _buffer: buffer,
            pointer,
        };
        check(
            UpdateProcThreadAttribute(
                value.pointer,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr().cast(),
                size_of_val(handles),
                null_mut(),
                null(),
            ),
            "handle list initialization",
        )?;
        Ok(value)
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.pointer);
        }
    }
}

unsafe fn execute(
    security: &Security,
    cwd: &Path,
    command: &OsStr,
    cancelled: &AtomicBool,
) -> Result<u32> {
    let cwd = match cwd.components().next() {
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::VerbatimDisk(_)) => {
            PathBuf::from(OsString::from_wide(
                &cwd.as_os_str().encode_wide().skip(4).collect::<Vec<_>>(),
            ))
        }
        _ => return Err("the Windows command shell requires a local drive cwd".into()),
    };
    let mut station_name = vec![0u16; 96];
    check(
        GetUserObjectInformationW(
            GetProcessWindowStation(),
            UOI_NAME,
            station_name.as_mut_ptr().cast(),
            (station_name.len() * 2) as u32,
            null_mut(),
        ),
        "window station lookup",
    )?;
    let handle = OpenWindowStationW(station_name.as_ptr(), 0, READ_CONTROL | WRITE_DAC);
    if handle.is_null() {
        return Err(format!(
            "window station open failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut station = Station {
        handle,
        security,
        granted: false,
    };
    station.access(true)?;
    let name = wide(format!("NookSandbox-{}", GetCurrentProcessId()));
    let desktop_acl = add_entries(
        &[
            entry(security.capability.0, GENERIC_ALL, 0),
            entry(security.user.as_ptr().cast_mut().cast(), GENERIC_ALL, 0),
            entry(security.owner_rights.0, READ_CONTROL, 0),
        ],
        null_mut(),
    )?;
    let mut desktop_descriptor = descriptor(desktop_acl.0.cast(), sacl(security.low_label.0)?)?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: (&mut desktop_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
        bInheritHandle: 0,
    };
    let handle = CreateDesktopW(name.as_ptr(), null(), null(), 0, GENERIC_ALL, &attributes);
    if handle.is_null() {
        return Err(format!(
            "private desktop failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let _desktop = Desktop(handle);
    let station_length = station_name.iter().position(|value| *value == 0).unwrap();
    let mut desktop_path: Vec<_> = station_name[..station_length]
        .iter()
        .copied()
        .chain([b'\\' as u16])
        .chain(name)
        .collect();
    let input = OpenOptions::new()
        .read(true)
        .open("NUL")
        .map_err(|error| error.to_string())?;
    let handles = [
        input.as_raw_handle(),
        GetStdHandle(STD_OUTPUT_HANDLE),
        GetStdHandle(STD_ERROR_HANDLE),
    ];
    for handle in handles {
        check(
            SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT),
            "stdio inheritance preparation",
        )?;
    }
    let attribute_list = Attributes::new(&handles)?;
    let mut startup: STARTUPINFOEXW = zeroed();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.lpDesktop = desktop_path.as_mut_ptr();
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attribute_list.pointer;
    let mut system = vec![0u16; 260];
    let length = GetSystemDirectoryW(system.as_mut_ptr(), system.len() as u32);
    if length == 0 || length as usize >= system.len() {
        return Err("system shell lookup failed".into());
    }
    let shell = PathBuf::from(OsString::from_wide(&system[..length as usize])).join("cmd.exe");
    let mut line = OsString::from("\"");
    line.push(&shell);
    line.push("\" /d /s /c \"");
    line.push(command);
    line.push("\"");
    let mut line = wide(line);
    let mut info: PROCESS_INFORMATION = zeroed();
    let job = Job::new()?;
    if cancelled.load(Ordering::Acquire) {
        return Err("execution cancelled".into());
    }
    check(
        CreateProcessAsUserW(
            security.token.0,
            wide(&shell).as_ptr(),
            line.as_mut_ptr(),
            &attributes,
            &attributes,
            1,
            CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
            null(),
            wide(cwd).as_ptr(),
            &startup.StartupInfo,
            &mut info,
        ),
        "sandboxed process creation",
    )?;
    let process = Process {
        handle: Handle(info.hProcess),
        thread: Handle(info.hThread),
    };
    check(
        AssignProcessToJobObject(job.0 .0, process.handle.0),
        "child process confinement",
    )?;
    if cancelled.load(Ordering::Acquire) {
        return Err("execution cancelled".into());
    }
    if ResumeThread(process.thread.0) == u32::MAX {
        return Err(format!(
            "process resume failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let result = loop {
        if cancelled.load(Ordering::Acquire) {
            break Err("execution cancelled".into());
        }
        match WaitForSingleObject(process.handle.0, 50) {
            WAIT_OBJECT_0 => {
                let mut code = 0;
                check(
                    GetExitCodeProcess(process.handle.0, &mut code),
                    "process result",
                )?;
                break Ok(code);
            }
            WAIT_TIMEOUT => {}
            _ => {
                break Err(format!(
                    "process wait failed: {}",
                    std::io::Error::last_os_error()
                ))
            }
        }
    };
    drop(job);
    drop(process);
    drop(_desktop);
    station.access(false)?;
    result
}

pub fn run() -> Result<u32> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() == 2 {
        unsafe {
            if args[1] == "--setup-devices" || args[1] == "--remove-device-grants" {
                return setup_devices(args[1] == "--remove-device-grants");
            }
            if args[1] == "--check-devices" {
                check_devices(Security::new()?.token.0)?;
                return Ok(0);
            }
            if args[1] == "--check-enforcement" {
                Security::new()?.validate_filesystem_restrictions()?;
                return Ok(0);
            }
        }
    }
    if args.len() != 6 || (args[1] != "read-only" && args[1] != "workspace-write") {
        return Err("invalid restricted execution request".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let watched = Arc::clone(&cancelled);
    std::thread::spawn(move || {
        let _ = std::io::stdin().read(&mut [0]);
        watched.store(true, Ordering::Release);
    });
    let workspace = fs::canonicalize(&args[2])
        .map_err(|error| format!("workspace canonicalization failed: {error}"))?;
    let temp = fs::canonicalize(&args[3])
        .map_err(|error| format!("private temp canonicalization failed: {error}"))?;
    let cwd = fs::canonicalize(&args[4])
        .map_err(|error| format!("cwd canonicalization failed: {error}"))?;
    if !workspace.is_dir() || !temp.is_dir() || !cwd.is_dir() {
        return Err("sandbox roots and cwd must be directories".into());
    }
    let workspace_pin = open(&workspace, FILE_READ_ATTRIBUTES, true)?;
    let temp_pin = open(&temp, FILE_READ_ATTRIBUTES, true)?;
    unsafe {
        verify_path(&workspace_pin, &workspace)?;
        verify_path(&temp_pin, &temp)?;
        let _lock = WorkspaceLock::acquire(&cancelled)?;
        let security = Security::new()?;
        security.validate_filesystem_restrictions()?;
        check_devices(security.token.0)?;
        let mut scope = AclScope {
            security: &security,
            roots: vec![temp.clone()],
            saved: Vec::new(),
        };
        let result = (|| {
            scope.grant_tree(&temp, &cancelled)?;
            if args[1] == "workspace-write" {
                scope.roots.push(workspace.clone());
                scope.grant_tree(&workspace, &cancelled)?;
            }
            execute(&security, &cwd, &args[5], &cancelled)
        })();
        let restored = scope.restore();
        match (result, restored) {
            (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
            (Err(error), _) | (_, Err(error)) => Err(error),
            (Ok(code), Ok(())) => Ok(code),
        }
    }
}
