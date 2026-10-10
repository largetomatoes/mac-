#!/bin/bash
# 问间 iOS 真机构建与安装脚本（免费 Apple ID / SideStore 两条路线均适用）
#
# 用法：
#   ./scripts/build-ios-device.sh            # 构建 Release 版并打出 IPA（默认）
#   ./scripts/build-ios-device.sh debug      # 构建 Debug 版
#   ./scripts/build-ios-device.sh install    # 构建并安装到 USB 连接的 iPhone（需 Xcode 登录 Apple ID）
#
# 前提：
#   1. Xcode 已安装，并在 Xcode → Settings → Accounts 登录你的 Apple ID（免费账号即可）
#   2. 首次构建时 Xcode 会自动生成个人团队的签名证书与描述文件
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/ios/App/App.xcodeproj"
SCHEME="App"
OUT="$ROOT/outputs/ios-device-build"
MODE="${1:-release}"

build_app() {
  local config="$1"
  echo "==> 构建 iOS 真机版（${config}）…"
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration "$config" \
    -destination 'generic/platform=iOS' \
    -allowProvisioningUpdates \
    -derivedDataPath "$OUT/derived" build 2>&1 | tail -5
  APP="$OUT/derived/Build/Products/$config-iphoneos/App.app"
  [ -d "$APP" ] || { echo "构建产物缺失：$APP"; exit 1; }
  echo "==> 构建完成：$APP"
}

make_ipa() {
  echo "==> 打包 IPA（供 SideStore / AltStore / 自签工具使用）…"
  rm -rf "$OUT/Payload" "$OUT/Wenjian-iOS.ipa"
  mkdir -p "$OUT/Payload"
  cp -R "$APP" "$OUT/Payload/"
  (cd "$OUT" && zip -qry Wenjian-iOS.ipa Payload)
  echo "==> IPA：$OUT/Wenjian-iOS.ipa"
  echo "    （SideStore/AltStore 里选择该文件即可安装；它们会用你自己的身份重新签名）"
}

install_device() {
  echo "==> 查找 USB 连接的 iPhone…"
  local udid
  udid=$(xcrun devicectl list devices 2>/dev/null | awk '/connected/{print $2; exit}')
  if [ -z "$udid" ]; then
    echo "未找到已连接且受信任的设备。请用数据线连接 iPhone 并在手机上点「信任此电脑」。"
    exit 1
  fi
  echo "==> 安装到设备 $udid …"
  xcrun devicectl device install app --device "$udid" "$APP"
  echo "==> 安装完成。首次启动前请在 设置 → 通用 → VPN与设备管理 中信任开发者证书。"
}

case "$MODE" in
  debug)
    build_app Debug
    make_ipa
    ;;
  install)
    build_app Release
    install_device
    ;;
  *)
    build_app Release
    make_ipa
    ;;
esac
