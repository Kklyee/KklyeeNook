use crate::acl::{open, setup_devices, verify_path, AclScope};
use crate::objects::check_devices;
use crate::process::execute;
use crate::token::Security;
use crate::win32::{wide, Handle, Result};
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::ptr::null;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Storage::FileSystem::FILE_READ_ATTRIBUTES;
use windows_sys::Win32::System::Threading::*;

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

pub fn run() -> Result<u32> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() == 6 && args[1] == "--probe-child" {
        if args[2] != "workspace-write" && args[2] != "read-only" {
            return Err("invalid enforcement probe mode".into());
        }
        return crate::probe::child(
            args[2] == "workspace-write",
            std::path::Path::new(&args[3]),
            std::path::Path::new(&args[4]),
            std::path::Path::new(&args[5]),
        );
    }
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
                return crate::probe::check_enforcement();
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
    execute_request(
        args[1] == "workspace-write",
        &args[2],
        &args[3],
        &args[4],
        &args[5],
        &cancelled,
    )
}

pub(crate) fn execute_request(
    writable: bool,
    workspace: &OsStr,
    temp: &OsStr,
    cwd: &OsStr,
    command: &OsStr,
    cancelled: &AtomicBool,
) -> Result<u32> {
    let workspace = fs::canonicalize(workspace)
        .map_err(|error| format!("workspace canonicalization failed: {error}"))?;
    let temp = fs::canonicalize(temp)
        .map_err(|error| format!("private temp canonicalization failed: {error}"))?;
    let cwd =
        fs::canonicalize(cwd).map_err(|error| format!("cwd canonicalization failed: {error}"))?;
    if !workspace.is_dir() || !temp.is_dir() || !cwd.is_dir() {
        return Err("sandbox roots and cwd must be directories".into());
    }
    let workspace_pin = open(&workspace, FILE_READ_ATTRIBUTES, true)?;
    let temp_pin = open(&temp, FILE_READ_ATTRIBUTES, true)?;
    unsafe {
        verify_path(&workspace_pin, &workspace)?;
        verify_path(&temp_pin, &temp)?;
        let _lock = WorkspaceLock::acquire(cancelled)?;
        let security = Security::new()?;
        check_devices(security.token.0)?;
        let mut scope = AclScope {
            security: &security,
            roots: Vec::new(),
            saved: Vec::new(),
        };
        let result = (|| {
            if writable {
                scope.roots.push(temp.clone());
                scope.grant_tree(&temp, cancelled)?;
                scope.roots.push(workspace.clone());
                scope.grant_tree(&workspace, cancelled)?;
            }
            execute(&security, &cwd, command, cancelled)
        })();
        let restored = scope.restore();
        match (result, restored) {
            (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
            (Err(error), _) | (_, Err(error)) => Err(error),
            (Ok(code), Ok(())) => Ok(code),
        }
    }
}
