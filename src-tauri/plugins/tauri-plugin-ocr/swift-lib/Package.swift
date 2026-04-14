// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "swift-lib",
    platforms: [.macOS(.v11)],
    products: [
        .library(name: "swift-lib", type: .static, targets: ["swift-lib"])
    ],
    targets: [
        .target(
            name: "swift-lib",
            path: "Sources"
        )
    ]
)
