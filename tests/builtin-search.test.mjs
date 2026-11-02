import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDomain,
  extractTimeAnchor,
} from "../lib/builtin-search.mjs";
import { executeLightweightSearch } from "../lib/search-adapter.mjs";

test("classifyDomain correctly identifies official and community sources", () => {
  // 1. 官方权威测试
  assert.equal(
    classifyDomain("https://github.com/nodejs/node/releases").tag,
    "[官方/权威]",
  );
  assert.equal(
    classifyDomain("https://nodejs.org/en/blog/release/v22.11.0").tag,
    "[官方/权威]",
  );
  assert.equal(
    classifyDomain("https://docs.python.org/3/whatsnew/3.13.html").tag,
    "[官方/权威]",
  );
  assert.equal(
    classifyDomain("https://en.wikipedia.org/wiki/JavaScript").tag,
    "[官方/权威]",
  );

  // 2. 技术社区测试
  assert.equal(
    classifyDomain("https://stackoverflow.com/questions/123456").tag,
    "[技术社区]",
  );
  assert.equal(
    classifyDomain("https://v2ex.com/t/987654").tag,
    "[技术社区]",
  );
  assert.equal(
    classifyDomain("https://juejin.cn/post/70000000").tag,
    "[技术社区]",
  );

  // 3. 经验参考/其他
  assert.equal(
    classifyDomain("https://personal-blog.example.com/article/1").tag,
    "[经验参考]",
  );
  assert.equal(classifyDomain("").tag, "[参考网页]");
});

test("extractTimeAnchor extracts recent years correctly", () => {
  assert.equal(
    extractTimeAnchor("Node.js 22.11.0 Active LTS in 2024"),
    " (2024年)",
  );
  assert.equal(
    extractTimeAnchor("ECMAScript 2025 specification draft"),
    " (2025年)",
  );
  assert.equal(extractTimeAnchor("Old text without year tag"), "");
});

test("executeLightweightSearch works in clean environment without host ctx.web", async () => {
  // 模拟没有 @copylee/dsh-free-search 的纯净宿主环境
  const cleanCtx = {}; // 无 web 属性

  // 测试关键词保护
  const emptyRes = await executeLightweightSearch(cleanCtx, []);
  assert.match(emptyRes, /未提供有效搜索词/);

  // 测试纯净环境下的自洽运行（不报 TypeError，能够优雅处理）
  const res = await executeLightweightSearch(cleanCtx, ["nodejs"], {
    timeoutMs: 3000,
  });
  assert.ok(typeof res === "string");
  assert.ok(res.length > 0);
});