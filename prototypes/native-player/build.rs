include!("../playback_build.rs");

fn main() {
    compile_playback_bridge();
    println!("cargo:rerun-if-changed=ui/player.slint");
    slint_build::compile("ui/player.slint").expect("compile native player UI");
}
