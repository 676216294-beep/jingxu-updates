# 镜序更新仓库

[下载最新正式版更新](https://github.com/676216294-beep/jingxu-updates/releases/latest)

已有在线更新功能的电脑：在软件中点击“软件更新 → 检查更新 → 立即更新”。各电脑的 data 记录保留本地。

发布方式：使用插件修改 payload 中的程序文件、对应 release-manifest.json 的 SHA-256 和 updates/release.json 的版本号／说明，在同一个提交中发布。GitHub Actions 校验文件后生成兼容现有更新器的附件，最后发布正式版本。不再手工上传压缩包，不修改客户端更新协议。提交前排除 API Key、订阅地址及个人记录。
