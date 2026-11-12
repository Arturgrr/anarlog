fn main() {
    println!("cargo:rerun-if-env-changed=VULKAN_SDK");
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if !windows || std::env::var_os("CARGO_FEATURE_VULKAN").is_none() {
        return;
    }
    // transcribe-cpp-sys links the Vulkan loader's import library by name
    // (`vulkan-1`) without its directory; the LunarG SDK keeps it in Lib.
    // Search paths propagate to every binary that links this crate.
    if let Some(sdk) = std::env::var_os("VULKAN_SDK") {
        let lib = std::path::Path::new(&sdk).join("Lib");
        println!("cargo:rustc-link-search=native={}", lib.display());
    }
    // `vulkan-1.dll` ships with GPU drivers, not with Windows. Load it on first
    // use so this crate's own test binaries start without it; `backends`
    // checks for it before ggml touches Vulkan. Link arguments do not reach
    // dependents: the desktop app's build script repeats these two lines.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
        println!("cargo:rustc-link-arg=delayimp.lib");
    }
}
