// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-apple-compliance",
  platforms: [.iOS(.v15)],
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
        .linkedFramework("AuthenticationServices"),
        .linkedFramework("StoreKit"),
      ])
  ]
)
