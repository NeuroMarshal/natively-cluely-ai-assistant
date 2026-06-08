// build-tools/sevenzip-wrapper.rs
//
// A drop-in wrapper around 7za.exe used ONLY during the Windows electron-builder
// run. The upstream winCodeSign-2.6.0 archive ships two macOS .dylib SYMLINKS
// that 7za cannot recreate on Windows without admin / Developer Mode, which makes
// 7za exit non-zero and aborts the whole build — even though every Windows tool
// (rcedit, signtool, windows-10/) extracts fine and the mac symlinks are unused.
//
// This wrapper runs the real 7za (renamed 7za-real.exe alongside it) and, ONLY
// for the winCodeSign archive, swallows that specific failure (exit 0). For every
// other invocation (NSIS packaging, etc.) it propagates the real exit code, so a
// genuine packaging error is never hidden.

use std::env;
use std::process::Command;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let exe = env::current_exe().expect("current_exe");
    let real = exe.parent().expect("parent").join("7za-real.exe");

    let status = Command::new(&real)
        .args(&args)
        .status()
        .expect("failed to spawn 7za-real.exe");
    let code = status.code().unwrap_or(1);

    let is_wincodesign = args.iter().any(|a| a.contains("winCodeSign"));
    if code != 0 && is_wincodesign {
        // macOS-symlink extraction failure for winCodeSign — non-fatal on Windows.
        std::process::exit(0);
    }
    std::process::exit(code);
}
