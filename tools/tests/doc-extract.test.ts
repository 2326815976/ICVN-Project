import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import test from "node:test";

import { extractLegacyWordTextWithTextutil } from "../../lib/server/document-extract.ts";

const fixturePath = "/Users/8086k/Downloads/笔录材料/丁传某讯问.doc";

test("extractLegacyWordTextWithTextutil extracts readable text from the provided .doc file", async () => {
  const docBuffer = await readFile(fixturePath);
  const extracted = await extractLegacyWordTextWithTextutil({
    fileName: "丁传某讯问.doc",
    contentBase64: docBuffer.toString("base64"),
  });

  console.log("\n[doc extract result begin]\n");
  console.log(extracted.text);
  console.log("\n[doc extract result end]\n");

  assert.ok(extracted.text.trim().length > 0);
  assert.match(extracted.text, /丁传某|讯问|笔录/u);
});
