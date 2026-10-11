use crate::acl::station_access;
use crate::token::Security;
use crate::win32::{check, wide, Handle, Result};
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::NtOpenDirectoryObject;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Security::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::StationsAndDesktops::*;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;

pub(crate) const SYSTEM_SID: &str = "S-1-5-21-2984733901-1447396327-1942789461-1";
pub(crate) const DEVICES: [&str; 3] = [
    r"\\?\GLOBALROOT\Device\Null",
    r"\\?\GLOBALROOT\Device\CNG",
    r"\\?\GLOBALROOT\Device\KsecDD",
];

pub(crate) unsafe fn open_device(path: &str, access: u32) -> Result<Handle> {
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

pub(crate) unsafe fn check_devices(token: HANDLE) -> Result<()> {
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

pub(crate) struct Desktop(pub(crate) HDESK);

pub(crate) unsafe fn open_object_directory(access: u32) -> Result<Handle> {
    let mut session = 0;
    check(
        ProcessIdToSessionId(GetCurrentProcessId(), &mut session),
        "object namespace session lookup",
    )?;
    let path = format!(r"\Sessions\{session}\BaseNamedObjects");
    open_directory(&path, access)
}

pub(crate) unsafe fn open_global_directory(access: u32) -> Result<Handle> {
    open_directory(r"\BaseNamedObjects", access)
}

pub(crate) unsafe fn open_directory(path: &str, access: u32) -> Result<Handle> {
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

pub(crate) struct Station<'a> {
    pub(crate) handle: HWINSTA,
    pub(crate) security: &'a Security,
    pub(crate) granted: bool,
}

impl Station<'_> {
    pub(crate) unsafe fn access(&mut self, grant: bool) -> Result<()> {
        station_access(self.handle, self.security.capability.0, grant)?;
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

pub(crate) unsafe fn create_desktop<'a>(
    security: &'a Security,
    attributes: &SECURITY_ATTRIBUTES,
) -> Result<(Station<'a>, Desktop, Vec<u16>)> {
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
    let handle = CreateDesktopW(name.as_ptr(), null(), null(), 0, GENERIC_ALL, attributes);
    if handle.is_null() {
        return Err(format!(
            "private desktop failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let _desktop = Desktop(handle);
    let station_length = station_name.iter().position(|value| *value == 0).unwrap();
    let desktop_path: Vec<_> = station_name[..station_length]
        .iter()
        .copied()
        .chain([b'\\' as u16])
        .chain(name)
        .collect();
    Ok((station, _desktop, desktop_path))
}
