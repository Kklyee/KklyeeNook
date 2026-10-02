use crate::objects::{
    open_device, open_global_directory, open_object_directory, DEVICES, SYSTEM_SID,
};
use crate::token::Security;
use crate::win32::{check, status, wide, Local, Result};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::StationsAndDesktops::*;
use windows_sys::Win32::System::SystemServices::{
    ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE, SECURITY_DESCRIPTOR_REVISION,
};

type FileId = (u32, u32, u32);

pub(crate) unsafe fn sid(value: &str) -> Result<Local> {
    let mut pointer = null_mut();
    check(
        ConvertStringSidToSidW(wide(value).as_ptr(), &mut pointer),
        "SID creation",
    )?;
    Ok(Local(pointer))
}

pub(crate) unsafe fn label(value: &str) -> Result<Local> {
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

pub(crate) unsafe fn dacl(descriptor: PSECURITY_DESCRIPTOR) -> Result<*mut ACL> {
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

pub(crate) unsafe fn sacl(descriptor: PSECURITY_DESCRIPTOR) -> Result<*mut ACL> {
    let (mut present, mut defaulted, mut acl) = (0, 0, null_mut());
    check(
        GetSecurityDescriptorSacl(descriptor, &mut present, &mut acl, &mut defaulted),
        "integrity label inspection",
    )?;
    Ok(acl)
}

pub(crate) unsafe fn descriptor(acl: *mut ACL, label: *mut ACL) -> Result<SECURITY_DESCRIPTOR> {
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

pub(crate) unsafe fn set_security(
    handle: HANDLE,
    acl: *mut ACL,
    label: *mut ACL,
    flags: u32,
) -> Result<()> {
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

unsafe fn prepare_inheritance(
    value: PSECURITY_DESCRIPTOR,
    original: PSECURITY_DESCRIPTOR,
) -> Result<()> {
    let (mut control, mut revision) = (0, 0);
    check(
        GetSecurityDescriptorControl(original, &mut control, &mut revision),
        "ACL inheritance inspection",
    )?;
    let mask = SE_DACL_PROTECTED
        | SE_SACL_PROTECTED
        | SE_DACL_AUTO_INHERITED
        | SE_SACL_AUTO_INHERITED
        | SE_DACL_AUTO_INHERIT_REQ
        | SE_SACL_AUTO_INHERIT_REQ;
    let mut flags = control & mask;
    if control & SE_DACL_AUTO_INHERITED != 0 {
        flags |= SE_DACL_AUTO_INHERIT_REQ;
    }
    if control & SE_SACL_AUTO_INHERITED != 0 {
        flags |= SE_SACL_AUTO_INHERIT_REQ;
    }
    check(
        SetSecurityDescriptorControl(value, mask, flags),
        "ACL inheritance preparation",
    )
}

unsafe fn set_file_security(
    handle: HANDLE,
    acl: *mut ACL,
    label: *mut ACL,
    original: PSECURITY_DESCRIPTOR,
) -> Result<()> {
    let mut value = descriptor(acl, label)?;
    let pointer = (&mut value as *mut SECURITY_DESCRIPTOR).cast();
    prepare_inheritance(pointer, original)?;
    check(
        SetKernelObjectSecurity(
            handle,
            DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
            pointer,
        ),
        "ACL preparation",
    )
}

pub(crate) unsafe fn get_security(handle: HANDLE) -> Result<Local> {
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

pub(crate) unsafe fn entry(
    principal: PSID,
    mode: ACCESS_MODE,
    access: u32,
    inheritance: u32,
) -> EXPLICIT_ACCESS_W {
    let mut value: EXPLICIT_ACCESS_W = zeroed();
    value.grfAccessPermissions = access;
    value.grfAccessMode = mode;
    value.grfInheritance = inheritance;
    value.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    value.Trustee.ptstrName = principal.cast();
    value
}

pub(crate) unsafe fn add_entries(
    entries: &[EXPLICIT_ACCESS_W],
    original: *mut ACL,
) -> Result<Local> {
    let mut value = null_mut();
    status(
        SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), original, &mut value),
        "ACL grant",
    )?;
    Ok(Local(value.cast()))
}

unsafe fn directory_acl(original: *mut ACL, world: PSID) -> Result<Vec<u32>> {
    let length = (*original).AclSize as usize + size_of::<ACCESS_DENIED_ACE>() - size_of::<u32>()
        + GetLengthSid(world) as usize;
    let mut buffer = vec![0u32; length.div_ceil(size_of::<u32>())];
    let acl = buffer.as_mut_ptr().cast();
    let revision = (*original).AclRevision as u32;
    check(
        InitializeAcl(acl, length as u32, revision),
        "directory ACL creation",
    )?;
    if !has_exact_ace(
        original,
        world,
        ACCESS_DENIED_ACE_TYPE,
        FILE_DELETE_CHILD,
        CONTAINER_INHERIT_ACE,
    )? {
        check(
            AddAccessDeniedAceEx(
                acl,
                revision,
                CONTAINER_INHERIT_ACE,
                FILE_DELETE_CHILD,
                world,
            ),
            "directory delete deny",
        )?;
    }
    for index in 0..(*original).AceCount as u32 {
        let mut ace = null_mut();
        check(GetAce(original, index, &mut ace), "ACE inspection")?;
        check(
            AddAce(
                acl,
                revision,
                u32::MAX,
                ace,
                (*ace.cast::<ACE_HEADER>()).AceSize as u32,
            ),
            "original ACE preservation",
        )?;
    }
    Ok(buffer)
}

pub(crate) unsafe fn remove_exact_ace(
    acl: *mut ACL,
    principal: PSID,
    ace_type: u32,
    mask: u32,
    inheritance: u32,
) -> Result<bool> {
    let mut removed = false;
    for index in (0..(*acl).AceCount as u32).rev() {
        let mut pointer = null_mut();
        check(GetAce(acl, index, &mut pointer), "ACE inspection")?;
        if ace_matches(pointer, principal, ace_type, mask, inheritance) {
            check(DeleteAce(acl, index), "ACL revocation")?;
            removed = true;
        }
    }
    Ok(removed)
}

unsafe fn ace_matches(
    pointer: *mut std::ffi::c_void,
    principal: PSID,
    ace_type: u32,
    mask: u32,
    inheritance: u32,
) -> bool {
    let header = &*pointer.cast::<ACE_HEADER>();
    if header.AceType as u32 != ace_type || header.AceFlags as u32 & !INHERITED_ACE != inheritance {
        return false;
    }
    let ace = &*pointer.cast::<ACCESS_ALLOWED_ACE>();
    EqualSid((&ace.SidStart as *const u32).cast_mut().cast(), principal) != 0 && ace.Mask == mask
}

unsafe fn has_exact_ace(
    acl: *mut ACL,
    principal: PSID,
    ace_type: u32,
    mask: u32,
    inheritance: u32,
) -> Result<bool> {
    for index in 0..(*acl).AceCount as u32 {
        let mut pointer = null_mut();
        check(GetAce(acl, index, &mut pointer), "ACE inspection")?;
        if ace_matches(pointer, principal, ace_type, mask, inheritance) {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(crate) fn open(path: &Path, access: u32, pin: bool) -> Result<File> {
    OpenOptions::new()
        .access_mode(access)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | if pin { 0 } else { FILE_SHARE_DELETE })
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("ACL open {} failed: {error}", path.display()))
}

pub(crate) unsafe fn information(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION> {
    let mut value = zeroed();
    check(
        GetFileInformationByHandle(file.as_raw_handle(), &mut value),
        "file identity inspection",
    )?;
    Ok(value)
}

pub(crate) fn identity(info: &BY_HANDLE_FILE_INFORMATION) -> FileId {
    (
        info.dwVolumeSerialNumber,
        info.nFileIndexHigh,
        info.nFileIndexLow,
    )
}

pub(crate) unsafe fn verify_path(file: &File, expected: &Path) -> Result<()> {
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

pub(crate) fn write_access(directory: bool) -> u32 {
    FILE_GENERIC_READ
        | FILE_GENERIC_WRITE
        | FILE_GENERIC_EXECUTE
        | DELETE
        | if directory { FILE_DELETE_CHILD } else { 0 }
}

pub(crate) struct SavedSecurity {
    file: File,
    descriptor: Local,
    id: FileId,
}

pub(crate) struct AclScope<'a> {
    pub(crate) security: &'a Security,
    pub(crate) roots: Vec<PathBuf>,
    pub(crate) saved: Vec<SavedSecurity>,
}

impl AclScope<'_> {
    pub(crate) unsafe fn grant_tree(&mut self, path: &Path, cancelled: &AtomicBool) -> Result<()> {
        if cancelled.load(Ordering::Acquire) {
            return Err("execution cancelled".into());
        }
        let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        let file = open(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER, false)?;
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
        let grant = write_access(metadata.is_dir());
        let entries = [
            entry(self.security.capability.0, GRANT_ACCESS, grant, inheritance),
            entry(
                self.security.owner_rights.0,
                GRANT_ACCESS,
                READ_CONTROL,
                inheritance,
            ),
        ];
        let updated = add_entries(&entries, original_dacl)?;
        let mut directory_acl = if metadata.is_dir() {
            Some(directory_acl(updated.0.cast(), self.security.everyone.0)?)
        } else {
            None
        };
        let acl = directory_acl
            .as_mut()
            .map_or(updated.0.cast(), |acl| acl.as_mut_ptr().cast());
        self.saved.push(SavedSecurity {
            file,
            descriptor: original,
            id: identity(&info),
        });
        let record = self.saved.last_mut().unwrap();
        set_file_security(
            record.file.as_raw_handle(),
            acl,
            sacl(self.security.low_label.0)?,
            record.descriptor.0,
        )?;
        if metadata.is_dir() {
            for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
                self.grant_tree(&entry.map_err(|error| error.to_string())?.path(), cancelled)?;
            }
        }
        Ok(())
    }

    unsafe fn strip_new_tree(
        &self,
        path: &Path,
        existing: &HashMap<FileId, &SavedSecurity>,
        inherited_user_deny: bool,
    ) -> Result<()> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        let file = open(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER, false)?;
        let info = information(&file)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Ok(());
        }
        verify_path(&file, path)?;
        let preserve_delete_deny = if let Some(record) = existing.get(&identity(&info)) {
            metadata.is_dir()
                && has_exact_ace(
                    dacl(record.descriptor.0)?,
                    self.security.everyone.0,
                    ACCESS_DENIED_ACE_TYPE,
                    FILE_DELETE_CHILD,
                    CONTAINER_INHERIT_ACE,
                )?
        } else {
            inherited_user_deny
        };
        if metadata.is_dir() {
            for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
                self.strip_new_tree(
                    &entry.map_err(|error| error.to_string())?.path(),
                    existing,
                    preserve_delete_deny,
                )?;
            }
        }
        if existing.contains_key(&identity(&info)) {
            return Ok(());
        }
        let original = get_security(file.as_raw_handle())?;
        let acl = dacl(original.0)?;
        let inheritance = if metadata.is_dir() {
            SUB_CONTAINERS_AND_OBJECTS_INHERIT
        } else {
            0
        };
        if remove_exact_ace(
            acl,
            self.security.capability.0,
            ACCESS_ALLOWED_ACE_TYPE,
            write_access(true),
            inheritance,
        )? {
            remove_exact_ace(
                acl,
                self.security.owner_rights.0,
                ACCESS_ALLOWED_ACE_TYPE,
                READ_CONTROL,
                inheritance,
            )?;
            if metadata.is_dir() && !preserve_delete_deny {
                remove_exact_ace(
                    acl,
                    self.security.everyone.0,
                    ACCESS_DENIED_ACE_TYPE,
                    FILE_DELETE_CHILD,
                    CONTAINER_INHERIT_ACE as u32,
                )?;
            }
            set_file_security(
                file.as_raw_handle(),
                acl,
                sacl(self.security.medium_label.0)?,
                original.0,
            )?;
        }
        Ok(())
    }

    pub(crate) unsafe fn restore(&mut self) -> Result<()> {
        let existing: HashMap<_, _> = self
            .saved
            .iter()
            .map(|record| (record.id, record))
            .collect();
        let mut errors = Vec::new();
        for root in &self.roots {
            if let Err(error) = self.strip_new_tree(root, &existing, false) {
                errors.push(error);
            }
        }
        self.roots.clear();
        while let Some(record) = self.saved.pop() {
            if let Err(error) = prepare_inheritance(record.descriptor.0, record.descriptor.0) {
                errors.push(error);
                continue;
            }
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

pub(crate) unsafe fn setup_devices(remove: bool) -> Result<u32> {
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
            remove_exact_ace(acl, principal.0, ACCESS_ALLOWED_ACE_TYPE, access, 0)?;
            let grant;
            let acl = if remove || access == 0 {
                acl
            } else {
                grant = add_entries(&[entry(principal.0, GRANT_ACCESS, access, 0)], acl)?;
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

pub(crate) unsafe fn station_access(handle: HWINSTA, principal: PSID, grant: bool) -> Result<()> {
    let flags = DACL_SECURITY_INFORMATION;
    let mut needed = 0;
    GetUserObjectSecurity(handle, &flags, null_mut(), 0, &mut needed);
    let mut original = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
    check(
        GetUserObjectSecurity(
            handle,
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
            &[entry(principal, GRANT_ACCESS, 0x037f | READ_CONTROL, 0)],
            acl,
        )?;
        acl = updated.0.cast();
    } else {
        remove_exact_ace(
            acl,
            principal,
            ACCESS_ALLOWED_ACE_TYPE,
            0x037f | READ_CONTROL,
            0,
        )?;
    }
    let mut value = descriptor(acl, null_mut())?;
    check(
        SetUserObjectSecurity(
            handle,
            &flags,
            (&mut value as *mut SECURITY_DESCRIPTOR).cast(),
        ),
        "window station ACL preparation",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn removal_preserves_other_world_aces() {
        unsafe {
            let world = sid("S-1-1-0").unwrap();
            let acl = add_entries(
                &[
                    entry(world.0, DENY_ACCESS, FILE_WRITE_EA, CONTAINER_INHERIT_ACE),
                    entry(
                        world.0,
                        GRANT_ACCESS,
                        FILE_DELETE_CHILD,
                        CONTAINER_INHERIT_ACE,
                    ),
                    entry(world.0, DENY_ACCESS, FILE_DELETE_CHILD, OBJECT_INHERIT_ACE),
                ],
                null_mut(),
            )
            .unwrap();
            let mut updated = directory_acl(acl.0.cast(), world.0).unwrap();
            let updated = updated.as_mut_ptr().cast::<ACL>();
            let count = (*updated).AceCount;
            assert!(remove_exact_ace(
                updated,
                world.0,
                ACCESS_DENIED_ACE_TYPE,
                FILE_DELETE_CHILD,
                CONTAINER_INHERIT_ACE,
            )
            .unwrap());
            assert_eq!((*updated).AceCount, count - 1);
            for (ace_type, mask, inheritance) in [
                (ACCESS_DENIED_ACE_TYPE, FILE_WRITE_EA, CONTAINER_INHERIT_ACE),
                (
                    ACCESS_ALLOWED_ACE_TYPE,
                    FILE_DELETE_CHILD,
                    CONTAINER_INHERIT_ACE,
                ),
                (
                    ACCESS_DENIED_ACE_TYPE,
                    FILE_DELETE_CHILD,
                    OBJECT_INHERIT_ACE,
                ),
            ] {
                assert!(remove_exact_ace(updated, world.0, ace_type, mask, inheritance).unwrap());
            }
        }
    }

    struct Directory(PathBuf);

    impl Drop for Directory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn deny_inherits_only_to_directories_and_cleanup_preserves_user_aces() {
        check_inheritance_and_cleanup(false);
    }

    #[test]
    fn cleanup_preserves_an_existing_directory_delete_deny() {
        check_inheritance_and_cleanup(true);
    }

    fn check_inheritance_and_cleanup(preserve_delete_deny: bool) {
        unsafe {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("nook-acl-{}-{timestamp}", std::process::id()));
            fs::create_dir(&root).unwrap();
            let root = Directory(fs::canonicalize(root).unwrap());
            let security = Security::new().unwrap();
            let file = open(&root.0, READ_CONTROL | WRITE_DAC | WRITE_OWNER, false).unwrap();
            let original = get_security(file.as_raw_handle()).unwrap();
            let original_dacl = dacl(original.0).unwrap();
            let entries = [
                entry(
                    security.everyone.0,
                    DENY_ACCESS,
                    FILE_WRITE_EA,
                    CONTAINER_INHERIT_ACE,
                ),
                entry(
                    security.everyone.0,
                    GRANT_ACCESS,
                    READ_CONTROL,
                    CONTAINER_INHERIT_ACE,
                ),
            ];
            let user_acl = add_entries(&entries, original_dacl).unwrap();
            let mut existing_deny = if preserve_delete_deny {
                Some(directory_acl(user_acl.0.cast(), security.everyone.0).unwrap())
            } else {
                None
            };
            let acl = existing_deny
                .as_mut()
                .map_or(user_acl.0.cast(), |acl| acl.as_mut_ptr().cast());
            set_security(
                file.as_raw_handle(),
                acl,
                null_mut(),
                DACL_SECURITY_INFORMATION,
            )
            .unwrap();
            let mut scope = AclScope {
                security: &security,
                roots: vec![root.0.clone()],
                saved: Vec::new(),
            };
            scope.grant_tree(&root.0, &AtomicBool::new(false)).unwrap();
            let nested = root.0.join("nested");
            fs::create_dir(&nested).unwrap();
            let child = nested.join("file.txt");
            fs::write(&child, "new").unwrap();
            assert!(open(&child, FILE_ALL_ACCESS, false).is_ok());
            assert!(open(&nested, FILE_ALL_ACCESS, false).is_err());
            let directory = open(&nested, READ_CONTROL, false).unwrap();
            let granted = get_security(directory.as_raw_handle()).unwrap();
            assert!(remove_exact_ace(
                dacl(granted.0).unwrap(),
                security.everyone.0,
                ACCESS_DENIED_ACE_TYPE,
                FILE_DELETE_CHILD,
                CONTAINER_INHERIT_ACE,
            )
            .unwrap());
            scope.restore().unwrap();
            let cleaned = get_security(directory.as_raw_handle()).unwrap();
            let acl = dacl(cleaned.0).unwrap();
            assert_eq!(
                remove_exact_ace(
                    acl,
                    security.everyone.0,
                    ACCESS_DENIED_ACE_TYPE,
                    FILE_DELETE_CHILD,
                    CONTAINER_INHERIT_ACE,
                )
                .unwrap(),
                preserve_delete_deny
            );
            assert!(remove_exact_ace(
                acl,
                security.everyone.0,
                ACCESS_DENIED_ACE_TYPE,
                FILE_WRITE_EA,
                CONTAINER_INHERIT_ACE,
            )
            .unwrap());
            assert!(remove_exact_ace(
                acl,
                security.everyone.0,
                ACCESS_ALLOWED_ACE_TYPE,
                READ_CONTROL,
                CONTAINER_INHERIT_ACE,
            )
            .unwrap());
            let child_handle = open(&child, READ_CONTROL, false).unwrap();
            let cleaned_child = get_security(child_handle.as_raw_handle()).unwrap();
            assert!(!remove_exact_ace(
                dacl(cleaned_child.0).unwrap(),
                security.capability.0,
                ACCESS_ALLOWED_ACE_TYPE,
                write_access(true),
                0,
            )
            .unwrap());
        }
    }
}
