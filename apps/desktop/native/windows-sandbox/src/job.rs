use crate::win32::{check, Handle, Result};
use std::mem::zeroed;
use std::ptr::{null, null_mut};
use std::time::Duration;
use windows_sys::Win32::System::JobObjects::*;

pub(crate) struct Job(pub(crate) Handle);

impl Job {
    pub(crate) unsafe fn new() -> Result<Self> {
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
