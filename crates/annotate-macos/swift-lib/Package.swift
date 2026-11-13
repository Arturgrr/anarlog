// swift-tools-version:5.9

import PackageDescription

// macOS 15, the app's minimum, is what ScreenCaptureKit's recording output
// needs; build.rs passes the same version to swift-rs. The module has its
// own name because every package here is linked into one app.
let package = Package(
  name: "annotate-swift",
  platforms: [.macOS("15.0")],
  products: [
    .library(
      name: "annotate-swift",
      type: .static,
      targets: ["AnnotateMacOS"])
  ],
  dependencies: [
    .package(
      url: "https://github.com/Brendonovich/swift-rs",
      revision: "207e4bfe5d36fdd0cc08f28d1849ff94ac7e24b8")
  ],
  targets: [
    .target(
      name: "AnnotateMacOS",
      dependencies: [
        .product(name: "SwiftRs", package: "swift-rs")
      ],
      path: "src"
    ),
    .testTarget(
      name: "AnnotateMacOSTests",
      dependencies: ["AnnotateMacOS"],
      path: "tests"
    ),
  ]
)
