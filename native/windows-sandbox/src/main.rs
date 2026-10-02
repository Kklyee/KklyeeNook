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
            eprintln!("Sandbox {error}");
            std::process::exit(125);
        }
    }
}
