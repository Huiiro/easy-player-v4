use std::{env, path::PathBuf};

fn compile_playback_bridge() {
    assert_eq!(env::var("TARGET").unwrap(), "x86_64-pc-windows-msvc");
    let repo = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    println!("cargo:rerun-if-env-changed=EASY_PLAYER_AUDIO_DEPS");
    let deps = env::var_os("EASY_PLAYER_AUDIO_DEPS")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("build/native-deps/installed/x64-windows-audio"));
    if !deps.join("include/libavformat/avformat.h").is_file() {
        panic!(
            "Audio dependencies missing at {}. Run npm run prepare:native first.",
            deps.display()
        );
    }

    let core = repo.join("engine-core");
    let windows = repo.join("engine-windows/src");
    let mut native = cc::Build::new();
    native
        .cpp(true)
        .std("c++17")
        .flag("/EHsc")
        .flag("/utf-8")
        .warnings(false)
        .include(core.join("include/easy_player"))
        .include(&windows)
        .include(deps.join("include"))
        .file("../native-player/src/audio_bridge.cpp");
    for file in ["audio_engine.cpp", "decoder.cpp", "ffmpeg_logging.cpp"] {
        native.file(core.join("src").join(file));
    }
    for file in [
        "asio_backend.cpp",
        "dsound_backend.cpp",
        "wasapi_backend.cpp",
        "windows_backend_factory.cpp",
    ] {
        native.file(windows.join(file));
    }
    for directory in [
        "../native-player/src/audio_bridge.cpp",
        "../../engine-core",
        "../../engine-windows/src",
    ] {
        println!("cargo:rerun-if-changed={directory}");
    }
    native.compile("easy_player_audio_bridge");

    println!(
        "cargo:rustc-link-search=native={}",
        deps.join("lib").display()
    );
    for lib in [
        "avcodec",
        "avformat",
        "avutil",
        "swresample",
        "samplerate",
        "SoundTouch",
        "winmm",
        "dsound",
        "dxguid",
        "ole32",
        "uuid",
        "advapi32",
    ] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}
