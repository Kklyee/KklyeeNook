use crate::acl::{add_entries, descriptor, entry, sacl};
use crate::job::Job;
use crate::objects::create_desktop;
use crate::token::Security;
use crate::win32::{check, wide, Handle, Result};
use std::ffi::{OsStr, OsString};
use std::fs::OpenOptions;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, PathBuf, Prefix};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::Authorization::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::READ_CONTROL;
use windows_sys::Win32::System::Console::*;
use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::*;

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

pub(crate) unsafe fn execute(
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
    let desktop_acl = add_entries(
        &[
            entry(security.capability.0, GRANT_ACCESS, GENERIC_ALL, 0),
            entry(
                security.user.as_ptr().cast_mut().cast(),
                GRANT_ACCESS,
                GENERIC_ALL,
                0,
            ),
            entry(security.owner_rights.0, GRANT_ACCESS, READ_CONTROL, 0),
        ],
        null_mut(),
    )?;
    let mut desktop_descriptor = descriptor(desktop_acl.0.cast(), sacl(security.low_label.0)?)?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: (&mut desktop_descriptor as *mut SECURITY_DESCRIPTOR).cast(),
        bInheritHandle: 0,
    };
    let (mut station, _desktop, mut desktop_path) = create_desktop(security, &attributes)?;
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
