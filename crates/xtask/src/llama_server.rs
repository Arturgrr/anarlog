//! Builds the llama-server the app bundles as `librelog-llama-server`: one
//! statically linked executable from llama.cpp at a pinned commit, with the
//! Metal shaders embedded, the web UI, RPC, HTTPS and subprocess support
//! left out.

use anyhow::{Context, Result, bail, ensure};
use std::{fs, path::Path};
use xshell::{Shell, cmd};

const REPOSITORY: &str = "https://github.com/ggml-org/llama.cpp";
/// llama.cpp v0.9.0.
const TAG: &str = "b12110";
const COMMIT: &str = "cd959bae99ff4bed22bef2604f45241c09bbb8c8";

/// Built-in models ship only for Apple silicon outside the App Store.
const SHIPPED_TRIPLE: &str = "aarch64-apple-darwin";

const CONFIGURE: &[&str] = &[
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DLLAMA_BUILD_SERVER=ON",
    "-DLLAMA_BUILD_TOOLS=ON",
    "-DLLAMA_BUILD_TESTS=OFF",
    "-DLLAMA_BUILD_EXAMPLES=OFF",
    "-DLLAMA_BUILD_APP=OFF",
    "-DGGML_METAL_EMBED_LIBRARY=ON",
    // The build machine's CPU features would crash older Apple silicon.
    "-DGGML_NATIVE=OFF",
    "-DGGML_RPC=OFF",
    "-DLLAMA_CONNECT=OFF",
    "-DLLAMA_OPENSSL=OFF",
    "-DLLAMA_BUILD_UI=OFF",
    "-DLLAMA_USE_PREBUILT_UI=OFF",
    // Without subprocess support the server cannot run tools at all.
    "-DLLAMA_SUBPROCESS=OFF",
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0",
    "-DCMAKE_OSX_ARCHITECTURES=arm64",
];

pub(crate) fn prepare(
    sh: &Shell,
    triple: &str,
    work_dir: &Path,
    binaries_dir: &Path,
) -> Result<()> {
    if triple != SHIPPED_TRIPLE {
        println!(
            "prepare-binaries: skipping librelog-llama-server: built-in models ship only for {SHIPPED_TRIPLE}"
        );
        return Ok(());
    }

    let source = work_dir.join(format!("llama.cpp-{TAG}"));
    let build = source.join("build-librelog");
    let dst = binaries_dir.join(format!("librelog-llama-server-{triple}"));
    let stamp = build.join("librelog-stamp");
    let expected_stamp = format!("{COMMIT}\n{}\n", CONFIGURE.join("\n"));
    if dst.is_file() && fs::read_to_string(&stamp).ok().as_deref() == Some(&expected_stamp) {
        println!("prepare-binaries: binaries/librelog-llama-server-{triple} is up to date");
        return Ok(());
    }

    if !source.join(".git").is_dir() {
        fs::create_dir_all(work_dir).context("create llama.cpp work directory")?;
        cmd!(
            sh,
            "git clone --depth 1 --branch {TAG} {REPOSITORY} {source}"
        )
        .run()?;
    }
    let head = cmd!(sh, "git -C {source} rev-parse HEAD").read()?;
    ensure!(
        head.trim() == COMMIT,
        "llama.cpp {TAG} resolved to {head}, not the pinned {COMMIT}; delete {} and check the tag",
        source.display()
    );

    let build_number = TAG.trim_start_matches('b');
    let short_commit = &COMMIT[..8];
    cmd!(
        sh,
        "cmake -S {source} -B {build} {CONFIGURE...} -DLLAMA_BUILD_NUMBER={build_number} -DLLAMA_BUILD_COMMIT={short_commit}"
    )
    .run()?;
    let jobs = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .to_string();
    cmd!(
        sh,
        "cmake --build {build} --config Release --target llama-server -j {jobs}"
    )
    .run()?;

    let built = build.join("bin").join("llama-server");
    check_system_libraries_only(sh, &built)?;
    fs::create_dir_all(binaries_dir).context("create binaries/")?;
    fs::copy(&built, &dst)
        .with_context(|| format!("copy {} -> {}", built.display(), dst.display()))?;
    fs::write(&stamp, expected_stamp).context("write build stamp")?;
    println!("prepare-binaries: binaries/librelog-llama-server-{triple}");
    Ok(())
}

/// The app bundles one file, so the server must not load llama.cpp or ggml
/// libraries from next to itself.
fn check_system_libraries_only(sh: &Shell, binary: &Path) -> Result<()> {
    let linked = cmd!(sh, "otool -L {binary}").read()?;
    let foreign: Vec<&str> = linked
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|line| !line.starts_with("/usr/lib/") && !line.starts_with("/System/Library/"))
        .collect();
    if !foreign.is_empty() {
        bail!(
            "{} links libraries outside the system: {}",
            binary.display(),
            foreign.join(", ")
        );
    }
    Ok(())
}
