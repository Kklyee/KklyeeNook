#[cfg(windows)]
mod acl;
#[cfg(windows)]
mod job;
#[cfg(windows)]
mod objects;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod sandbox;
#[cfg(windows)]
mod token;
#[cfg(windows)]
mod win32;

fn main() {
    #[cfg(windows)]
    let result = sandbox::run();
    #[cfg(not(windows))]
    let result: Result<u32, String> = Err("Windows sandbox is unavailable on this platform".into());
    match result {
        Ok(code) => std::process::exit(code as i32),
        Err(error) => {
            let (code, reason) = error
                .split_once(": ")
                .filter(|(code, _)| {
                    matches!(
                        *code,
                        "workspace_root_acl_failed"
                            | "sandbox_policy_init_failed"
                            | "process_spawn_failed"
                    )
                })
                .unwrap_or(("sandbox_policy_init_failed", &error));
            eprintln!("Sandbox launch error [{code}]: {reason}");
            std::process::exit(125);
        }
    }
}
