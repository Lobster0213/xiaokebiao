const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inlineScript) throw new Error("index.html 找不到內嵌應用程式");
new Function(inlineScript[1]);

const domainPath = path.join(root, "app-domain.js");
delete require.cache[require.resolve(domainPath)];
const domain = require(domainPath);
if (domain.DATA_VERSION !== 8) throw new Error("DATA_VERSION 必須為 8");
for (const required of ["autoCompleteOverdueLessons", "rescheduleLessonTransaction", "onboardingCurrentStep", "新增課程"]) {
  if (!html.includes(required) && !fs.readFileSync(domainPath, "utf8").includes(required)) throw new Error(`v0.8 缺少 ${required}`);
}

JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
new Function(fs.readFileSync(path.join(root, "service-worker.js"), "utf8"));

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
for (const required of ["app-domain.js", "actions/configure-pages", "actions/deploy-pages"]) {
  if (!workflow.includes(required)) throw new Error(`Pages workflow 缺少 ${required}`);
}

console.log("Static validation passed.");
