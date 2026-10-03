use crate::sandbox::execute_request;
use crate::win32::Result;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

struct ProbeDirectory(PathBuf);

impl Drop for ProbeDirectory {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!("Sandbox enforcement probe cleanup failed: {error}");
        }
    }
}

fn denied(result: std::io::Result<()>, operation: &str) -> Result<()> {
    match result {
        Err(error) if error.kind() == ErrorKind::PermissionDenied => Ok(()),
        Err(error) => Err(format!(
            "{operation} failed for an unexpected reason: {error}"
        )),
        Ok(()) => Err(format!("filesystem boundary allowed {operation}")),
    }
}

fn check_root(root: &Path, writable: bool) -> Result<()> {
    let existing = root.join("existing.txt");
    if fs::read_to_string(&existing).map_err(|error| error.to_string())? != "original" {
        return Err("enforcement probe fixture changed".into());
    }
    let new = root.join("new.txt");
    if writable {
        fs::write(&new, "created").map_err(|error| error.to_string())?;
        fs::write(&existing, "changed").map_err(|error| error.to_string())?;
        fs::remove_file(&new).map_err(|error| error.to_string())?;
        fs::remove_file(&existing).map_err(|error| error.to_string())?;
        let nested = root.join("nested");
        fs::create_dir(&nested).map_err(|error| error.to_string())?;
        fs::write(nested.join("file.txt"), "nested").map_err(|error| error.to_string())?;
        fs::remove_dir_all(&nested).map_err(|error| error.to_string())?;
    } else {
        denied(fs::write(&new, "escaped"), "file creation")?;
        denied(
            fs::write(&existing, "escaped"),
            "existing file modification",
        )?;
        denied(fs::remove_file(&existing), "existing file deletion")?;
        denied(fs::create_dir(root.join("nested")), "directory creation")?;
    }
    Ok(())
}

pub(crate) fn child(writable: bool, workspace: &Path, temp: &Path, outside: &Path) -> Result<u32> {
    check_root(workspace, writable)?;
    check_root(temp, writable)?;
    check_root(outside, false)?;
    check_root(&workspace.join("junction"), false)?;
    Ok(0)
}

pub(crate) fn check_enforcement() -> Result<u32> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "nook-enforcement-{}-{timestamp}",
        std::process::id()
    ));
    fs::create_dir(&root).map_err(|error| error.to_string())?;
    let root = ProbeDirectory(root);
    let workspace = root.0.join("workspace");
    let temp = root.0.join("private-temp");
    let outside = root.0.join("outside");
    for path in [&workspace, &temp, &outside] {
        fs::create_dir(path).map_err(|error| error.to_string())?;
    }
    let junction = Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(workspace.join("junction"))
        .arg(&outside)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("enforcement probe junction creation failed: {error}"))?;
    if !junction.status.success() {
        return Err(format!(
            "enforcement probe junction creation failed: {}",
            String::from_utf8_lossy(&junction.stderr)
        ));
    }
    let helper = std::env::current_exe().map_err(|error| error.to_string())?;
    for mode in ["workspace-write", "read-only"] {
        for path in [&workspace, &temp, &outside] {
            fs::write(path.join("existing.txt"), "original").map_err(|error| error.to_string())?;
        }
        let args = [
            OsString::from("--probe-child"),
            OsString::from(mode),
            workspace.as_os_str().to_owned(),
            temp.as_os_str().to_owned(),
            outside.as_os_str().to_owned(),
        ];
        let code = execute_request(
            mode == "workspace-write",
            workspace.as_os_str(),
            temp.as_os_str(),
            workspace.as_os_str(),
            helper.as_os_str(),
            &args,
            &AtomicBool::new(false),
        )?;
        if code != 0 {
            return Err(format!(
                "filesystem enforcement probe failed in {mode} (exit {code})"
            ));
        }
        if fs::read_to_string(outside.join("existing.txt")).map_err(|error| error.to_string())?
            != "original"
            || outside.join("new.txt").exists()
        {
            return Err("filesystem enforcement probe changed outside files".into());
        }
    }
    Ok(0)
}
