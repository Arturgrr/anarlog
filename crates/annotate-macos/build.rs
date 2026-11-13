fn main() {
    #[cfg(target_os = "macos")]
    {
        // ScreenCaptureKit's recording output needs macOS 15, the app's minimum.
        swift_rs::SwiftLinker::new("15.0")
            .with_package("annotate-swift", "./swift-lib/")
            .link();
    }

    #[cfg(not(target_os = "macos"))]
    {
        println!("cargo:warning=Swift linking is only available on macOS");
    }
}
