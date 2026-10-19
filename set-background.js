const fs = require('fs');
const path = require('path');

const PATCH_DIR = __dirname;
let imgPath = process.argv[2]?.replace(/^["']|["']$/g, '');

if (!imgPath) {
  // Check if there is an image in assets folder
  const candidateExtensions = ['.webp', '.png', '.jpg', '.jpeg', '.gif'];
  for (const ext of candidateExtensions) {
    const p = path.join(PATCH_DIR, 'assets', `background${ext}`);
    if (fs.existsSync(p)) {
      imgPath = p;
      break;
    }
  }
}

if (!imgPath || !fs.existsSync(imgPath)) {
  console.error('错误: 请提供有效的图片路径 (支持 PNG, JPG, JPEG, WebP, GIF)');
  console.error('用法: node set-background.js "C:\\path\\to\\image.png"');
  process.exit(1);
}

const ext = path.extname(imgPath).toLowerCase();
let mime = 'image/webp';
if (ext === '.png') mime = 'image/png';
else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
else if (ext === '.webp') mime = 'image/webp';
else if (ext === '.gif') mime = 'image/gif';
else {
  console.error(`错误: 不支持图片扩展名 ${ext}`);
  process.exit(1);
}

console.log(`正在读取图片: ${imgPath}`);
const buffer = fs.readFileSync(imgPath);
const base64 = buffer.toString('base64');
const dataUri = `data:${mime};base64,${base64}`;

const targetDataUrl = path.join(PATCH_DIR, 'assets', 'background.dataurl.txt');
fs.mkdirSync(path.dirname(targetDataUrl), { recursive: true });
fs.writeFileSync(targetDataUrl, dataUri, 'utf8');
console.log(`[OK] 已更新 assets/background.dataurl.txt (Base64 大小: ${Math.round(dataUri.length / 1024)} KB)`);

// Auto rebuild bootstrap.js
require('./build_bootstrap.js').buildBootstrap();

console.log('====================================================================');
console.log('  [OK] 壁纸更换并编译完成！');
console.log('  目录安装会自动重载；ASAR 安装需要重新运行安装脚本。');
console.log('====================================================================');
