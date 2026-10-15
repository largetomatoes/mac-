# 第三方材料与许可范围

本项目的自定义 [LICENSE](LICENSE) 只授权有权以该许可提供的项目材料，
不替代、收回或改变第三方许可证，也不把第三方版权归给西林sirens。

## 源码中的现有声明

- [vendor/shadcn-tailwind-4.13.0.LICENSE.md](vendor/shadcn-tailwind-4.13.0.LICENSE.md)
- [build/sites-vite-plugin.LICENSE](build/sites-vite-plugin.LICENSE)
- 相关源文件自带的版权、许可及来源声明

## 依赖与构建产物

依赖名称及固定版本见 [package-lock.json](package-lock.json) 和
[work/mac-app/package-lock.json](work/mac-app/package-lock.json)。实际分发时，
还应根据真正随包提供的运行库、字体、OCR 模型及其他资产，保留其许可和声明。
不得仅因把文件放进本仓库，就将第三方材料改按本项目许可再授权。

本次锁文件核对发现需特别保留原条件的材料包括：

- `sharp` 相关 `@img/sharp-libvips-*` 或部分 WASM/Windows 二进制：锁文件
  包含 LGPL-3.0-or-later 或与 Apache/MIT 的组合声明。应根据实际分发的
  组件核对其通知、源码或替换/重新链接要求；不能只保留本项目 LICENSE。
- 标记为 MPL-2.0 的依赖：应按其文件级许可及实际分发情况履行相应义务。
- `jszip` 的锁文件标识为 `MIT OR GPL-3.0-or-later`；采用其中的 MIT
  授权时仍须保留对应 MIT 许可与版权声明。

锁文件包含开发、可选及各平台依赖，不代表每一项都进入每个安装包；
上述是来源与风险提示，不是完成全部传递依赖或所有平台产物法律审计的声明。
如第三方条件要求组合成果按其许可发行，须先满足条件、取得有效额外授权，
或避免相应组合；本项目的商业许可不豁免这些条件。

公开源码和构建说明不要求提供用户原书、个人笔记或私钥；官方更新签名公钥
与签名私钥应区分。第三方书籍和用户独立创作内容不会因使用问间被重新授权。
