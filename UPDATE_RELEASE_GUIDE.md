# 圆周率版本与应用内更新发布

公开版本按3.1、3.14、3.141、3.1415等前缀推进，比较规则在lib/app-updates.ts。桌面package.json的releaseVersion是公开版本，version是独立的内部三段版本；buildVersion、CFBundleVersion、Android versionCode使用同一递增整数。3.1为内部3.2.0、build310，后续从311继续增加。

保持应用标识、应用名、资料目录及Android签名证书。生成三端包，检查空白seed、无个人资料、离线资源、UTF-8与Windows归档，然后产生SHA256SUMS.txt。

应用内更新清单update-manifest.json是一个JSON对象：payload保存schema、version、build和各平台的url、size、sha256；signature为payload原始UTF-8字节的RSA/SHA-256签名（Base64）。payload应固定字节形式，签完不要重新排版。程序内固定公钥，私钥仅由发布者私有保存，不进Git或安装包。Android还检查与已安装应用相同的签名证书。

先推送源码，再创建draft Release。上传三端包、校验文件、签名清单和发行说明，逐个核对GitHub返回的size/digest。核验安装和回退、草稿保护后正式发布，再更新官网链接并核验实际下载。旧发布只在新发布核验后撤下，保留私有回退副本。

测试生成的替代密钥仅用于隔离单元测试，不可替换发布公钥。不要把新版“打开下载页面”当作自动安装；当前安装实现位于work/mac-app/asar-src/app-updater.cjs及Android WenjianUpdateClient.java。
