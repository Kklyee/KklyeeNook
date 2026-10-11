use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::*;

pub(crate) type Result<T> = std::result::Result<T, String>;

pub(crate) fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

pub(crate) fn check(value: i32, stage: &str) -> Result<()> {
    if value == 0 {
        Err(format!(
            "{stage} failed: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn status(value: u32, stage: &str) -> Result<()> {
    if value != 0 {
        Err(format!(
            "{stage} failed: {}",
            std::io::Error::from_raw_os_error(value as i32)
        ))
    } else {
        Ok(())
    }
}

pub(crate) struct Handle(pub(crate) HANDLE);

impl Handle {
    pub(crate) fn new(value: HANDLE, stage: &str) -> Result<Self> {
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

pub(crate) struct Local(pub(crate) *mut c_void);

impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
