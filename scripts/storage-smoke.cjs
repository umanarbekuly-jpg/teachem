const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const base = "http://localhost:8080/api/v1";
function client() {
  let cookies = new Map(),
    csrf;
  return {
    async call(path, method = "GET", body) {
      const headers = {
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        Origin: "http://localhost:8080",
      };
      if (csrf) headers["X-CSRF-Token"] = csrf;
      if (body) headers["Content-Type"] = "application/json";
      const r = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const value of r.headers.getSetCookie()) {
        const pair = value.split(";")[0],
          i = pair.indexOf("=");
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const data = await r.json();
      if (path === "/auth/csrf") csrf = data.token;
      return { status: r.status, data };
    },
  };
}
async function main() {
  const tutor = client(),
    stranger = client();
  for (const [agent, role] of [
    [tutor, "tutor"],
    [stranger, "student"],
  ]) {
    await agent.call("/auth/csrf");
    const r = await agent.call("/auth/register", "POST", {
      email: `storage-${randomUUID()}@example.test`,
      password: "storage-test-password",
      name: "Storage Test",
      role,
    });
    assert.equal(r.status, 201);
  }
  const bytes = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  );
  const u = await tutor.call("/files/uploads", "POST", {
    purpose: "material",
    originalName: "lesson.pdf",
    mimeType: "application/pdf",
    sizeBytes: bytes.length,
  });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const form = new FormData();
  for (const [k, v] of Object.entries(u.data.fields)) form.append(k, v);
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "lesson.pdf",
  );
  const uploaded = await fetch(u.data.url, { method: "POST", body: form });
  assert.ok(uploaded.ok, await uploaded.text());
  const complete = await tutor.call(`/files/${u.data.id}/complete`, "POST", {});
  assert.equal(complete.status, 201, JSON.stringify(complete.data));
  assert.equal(
    (await stranger.call(`/files/${u.data.id}/download`)).status,
    403,
  );
  const link = await tutor.call(`/files/${u.data.id}/download`);
  assert.equal(link.status, 200);
  const downloaded = await fetch(link.data.url);
  assert.ok(downloaded.ok);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  const invalid = await tutor.call("/files/uploads", "POST", {
    purpose: "material",
    originalName: "x.pdf",
    mimeType: "text/html",
    sizeBytes: 20,
  });
  assert.equal(invalid.status, 400);
  const oversize = await tutor.call("/files/uploads", "POST", {
    purpose: "material",
    originalName: "large.pdf",
    mimeType: "application/pdf",
    sizeBytes: 20971521,
  });
  assert.equal(oversize.status, 400);
  const replacement = new FormData();
  for (const [k, v] of Object.entries(u.data.fields)) replacement.append(k, v);
  replacement.append(
    "file",
    new Blob([Buffer.alloc(bytes.length, 65)], { type: "application/pdf" }),
    "lesson.pdf",
  );
  assert.ok(
    (await fetch(u.data.url, { method: "POST", body: replacement })).ok,
  );
  assert.deepEqual(
    Buffer.from(await (await fetch(link.data.url)).arrayBuffer()),
    bytes,
  );
  console.log(
    "PASS: presigned upload, validation, ready download, ownership, MIME, size and overwrite isolation (S3-compatible emulator)",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
