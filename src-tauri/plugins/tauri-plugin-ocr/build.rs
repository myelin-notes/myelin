fn main() {
    #[cfg(target_os = "macos")]
    {
        swift_rs::SwiftLinker::new("11.0")
            .with_package("swift-lib", "./swift-lib/")
            .link();

        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}
