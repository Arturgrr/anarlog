const COMMANDS: &[&str] = &[
    "foundation_model_availability",
    "foundation_model_begin",
    "foundation_model_cancel",
    "foundation_model_generate",
];

fn main() {
    #[cfg(target_os = "macos")]
    {
        swift_rs::SwiftLinker::new("14.2")
            .with_package("apple-foundation-swift", "./swift-lib/")
            .link();

        println!("cargo:rerun-if-changed=swift-lib/src");
        println!("cargo:rerun-if-changed=swift-lib/Package.swift");
        println!("cargo:rerun-if-changed=swift-lib/Package.resolved");
    }

    tauri_plugin::Builder::new(COMMANDS).build();
}
