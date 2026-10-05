// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-apple-compliance",
  platforms: [.iOS(.v14)],
  products: [
    .library(
      name: "tauri-plugin-apple-compliance",
      type: .static,
      targets: ["tauri-plugin-apple-compliance"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-apple-compliance",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources",
      linkerSettings: [
        .linkedFramework("AuthenticationServices")
      ])
  ]
)
