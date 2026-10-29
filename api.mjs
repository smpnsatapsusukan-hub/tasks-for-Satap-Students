import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { STUDENTS, TEACHER_HASH } from "./students.mjs";

/* ---------- util ---------- */
const SALT = "sk4-sem1-2627", ITER = 50000;
const hash = (p) => crypto.pbkdf2Sync(p, SALT, ITER, 32, "sha256").toString("hex");
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const BY = new Map(STUDENTS.map((s) => [s.n, s]));
const KELAS = [...new Set(STUDENTS.map((s) => s.k))].sort();
const db = () => getStore({ name: "kelas", consistency: "strong" });
const getj = (k) => db().get(k, { type: "json" });
const setj = (k, v) => db().setJSON(k, v);
const del = (k) => db().delete(k);
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
class E extends Error { constructor(m, c = 400) { super(m); this.c = c; } }
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function pmap(arr, fn, n = 15) {
  const out = new Array(arr.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const j = i++; out[j] = await fn(arr[j], j); }
  }));
  return out;
}
const PWCHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genPw = (n = 6) => Array.from({ length: n }, () => PWCHARS[crypto.randomInt(PWCHARS.length)]).join("");
const stat = (s) => (s?.score != null ? "dinilai" : s?.submittedAt ? "terkumpul" : "belum");
const cleanImgs = (arr, max) => {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).filter((x) => typeof x === "string" && x.startsWith("data:image/jpeg;base64,") && x.length <= 900000);
};
const needGuru = (u) => { if (u.role !== "guru") throw new E("Khusus guru", 403); };

/* ---------- auth ---------- */
async function auth(b) {
  const role = b.role, id = String(b.uid ?? "").trim(), pass = String(b.pass ?? "");
  if (!pass || pass.length > 100) return null;
  if (role === "guru") {
    const o = await getj("pw/guru");
    return same(hash(pass), o?.h || TEACHER_HASH) ? { role, id: "guru", name: "Guru" } : null;
  }
  if (role !== "siswa" && role !== "ortu") return null;
  const st = BY.get(id);
  if (!st) { hash(pass); return null; }
  const o = await getj(`pw/${id}`);
  const want = role === "siswa" ? o?.s || st.s : o?.o || st.o;
  if (!same(hash(pass), want)) return null;
  return { role, id, name: role === "siswa" ? st.nama : "Orang/Wali " + st.nama, anak: st.nama, kelas: st.k };
}

/* ---------- helpers data ---------- */
const getTasks = async () => (await getj("tasks")) || [];
const canSee = (u, t) => u.role === "guru" || t.kelas === "all" || t.kelas === u.kelas;
async function loadSub(taskId, nipd, imgs = true) {
  const s = (await getj(`sub/${taskId}/${nipd}`)) || { thread: [] };
  if (imgs && s.nimg) s.imgs = (await getj(`simg/${taskId}/${nipd}`)) || [];
  return s;
}
async function saveSub(taskId, nipd, s) { await setj(`sub/${taskId}/${nipd}`, s); }
const studentsOf = (kelas) => STUDENTS.filter((s) => kelas === "all" || s.k === kelas);

/* ---------- aksi ---------- */
const A = {};

A.login = async (u) => ({ role: u.role, id: u.id, name: u.name, anak: u.anak, kelas: u.kelas, kelasList: KELAS });

A.list = async (u) => {
  const tasks = await getTasks();
  if (u.role === "guru") return { tasks, kelasList: KELAS };
  const vis = tasks.filter((t) => canSee(u, t)).slice(0, 100);
  const out = await pmap(vis, async (t) => {
    const s = await getj(`sub/${t.id}/${u.id}`);
    return { ...t, status: stat(s), score: s?.score ?? null, submittedAt: s?.submittedAt || null, nc: s?.thread?.length || 0 };
  });
  return { tasks: out };
};

A.task_get = async (u, b) => {
  const t = (await getTasks()).find((x) => x.id === b.id);
  if (!t || !canSee(u, t)) throw new E("Tugas tidak ditemukan", 404);
  const out = { task: t, img: t.hasImg ? await getj(`timg/${t.id}`) : null };
  if (u.role !== "guru") out.sub = await loadSub(t.id, u.id);
  return out;
};

A.submit = async (u, b) => {
  if (u.role !== "siswa") throw new E("Hanya siswa yang dapat mengumpulkan tugas", 403);
  const t = (await getTasks()).find((x) => x.id === b.taskId);
  if (!t || !canSee(u, t)) throw new E("Tugas tidak ditemukan", 404);
  const answer = clip(b.answer, 6000), imgs = cleanImgs(b.imgs, 3);
  if (!answer && !imgs.length) throw new E("Jawaban masih kosong");
  const cur = await loadSub(t.id, u.id, false);
  if (cur.score != null) throw new E("Tugas sudah dinilai guru, tidak dapat diubah lagi");
  cur.answer = answer; cur.submittedAt = Date.now(); cur.nimg = imgs.length;
  if (imgs.length) await setj(`simg/${t.id}/${u.id}`, imgs); else await del(`simg/${t.id}/${u.id}`);
  await saveSub(t.id, u.id, cur);
  return { ok: true };
};

A.comment = async (u, b) => {
  const text = clip(b.text, 1000);
  if (!text) throw new E("Komentar kosong");
  const nipd = u.role === "guru" ? String(b.nipd || "") : u.id;
  if (!BY.has(nipd)) throw new E("Siswa tidak ditemukan", 404);
  const t = (await getTasks()).find((x) => x.id === b.taskId);
  if (!t || !canSee(u, t)) throw new E("Tugas tidak ditemukan", 404);
  const cur = await loadSub(t.id, nipd, false);
  cur.thread = cur.thread || [];
  cur.thread.push({ f: u.role, t: text, at: Date.now() });
  if (cur.thread.length > 200) cur.thread = cur.thread.slice(-200);
  await saveSub(t.id, nipd, cur);
  return { thread: cur.thread };
};

A.change_pw = async (u, b) => {
  const np = String(b.newpass ?? "");
  if (np.length < 6 || np.length > 40) throw new E("Password baru minimal 6 karakter");
  const key = u.role === "guru" ? "pw/guru" : `pw/${u.id}`;
  const cur = (await getj(key)) || {};
  if (u.role === "guru") cur.h = hash(np); else if (u.role === "siswa") cur.s = hash(np); else cur.o = hash(np);
  await setj(key, cur);
  return { ok: true };
};

/* ---- khusus guru ---- */
A.task_save = async (u, b) => {
  needGuru(u);
  const judul = clip(b.judul, 120);
  if (!judul) throw new E("Judul wajib diisi");
  const kelas = b.kelas === "all" || KELAS.includes(String(b.kelas)) ? String(b.kelas) : "all";
  const link = clip(b.link, 500);
  const tasks = await getTasks();
  let t = b.id ? tasks.find((x) => x.id === b.id) : null;
  const isNew = !t;
  if (isNew) { t = { id: crypto.randomUUID().slice(0, 8), created: Date.now() }; }
  Object.assign(t, {
    judul, kelas, desc: clip(b.desc, 6000), link: /^https?:\/\//i.test(link) ? link : "",
    due: Number(b.due) || null, max: Math.min(1000, Math.max(1, Number(b.max) || 100)),
  });
  const img = b.img === undefined ? undefined : cleanImgs(b.img ? [b.img] : [], 1)[0] || null;
  if (img) { await setj(`timg/${t.id}`, img); t.hasImg = true; }
  else if (img === null) { await del(`timg/${t.id}`); t.hasImg = false; }
  if (isNew) tasks.unshift(t);
  await setj("tasks", tasks);
  return { task: t };
};

A.task_delete = async (u, b) => {
  needGuru(u);
  const tasks = (await getTasks()).filter((x) => x.id !== b.id);
  await setj("tasks", tasks);
  const keys = [];
  for (const p of [`sub/${b.id}/`, `simg/${b.id}/`]) {
    const r = await db().list({ prefix: p });
    keys.push(...r.blobs.map((x) => x.key));
  }
  keys.push(`timg/${b.id}`);
  await pmap(keys, (k) => del(k));
  return { ok: true };
};

A.subs = async (u, b) => {
  needGuru(u);
  const t = (await getTasks()).find((x) => x.id === b.id);
  if (!t) throw new E("Tugas tidak ditemukan", 404);
  const sts = studentsOf(t.kelas);
  const rows = await pmap(sts, async (s) => {
    const x = await getj(`sub/${t.id}/${s.n}`);
    const th = x?.thread || [];
    return {
      n: s.n, nama: s.nama, k: s.k, status: stat(x), submittedAt: x?.submittedAt || null,
      score: x?.score ?? null, nc: th.length, lastFrom: th.length ? th[th.length - 1].f : null,
    };
  });
  return { task: t, rows };
};

A.sub_get = async (u, b) => {
  needGuru(u);
  const st = BY.get(String(b.nipd));
  if (!st) throw new E("Siswa tidak ditemukan", 404);
  return { sub: await loadSub(b.taskId, st.n), siswa: { n: st.n, nama: st.nama, k: st.k } };
};

A.grade = async (u, b) => {
  needGuru(u);
  const t = (await getTasks()).find((x) => x.id === b.taskId);
  const st = BY.get(String(b.nipd));
  if (!t || !st) throw new E("Data tidak ditemukan", 404);
  const cur = await loadSub(t.id, st.n, false);
  if (b.score === "" || b.score == null) { delete cur.score; delete cur.feedback; delete cur.gradedAt; }
  else {
    const sc = Number(b.score);
    if (!Number.isFinite(sc) || sc < 0 || sc > t.max) throw new E(`Nilai harus 0 – ${t.max}`);
    cur.score = Math.round(sc * 100) / 100; cur.feedback = clip(b.feedback, 1500); cur.gradedAt = Date.now();
  }
  await saveSub(t.id, st.n, cur);
  return { ok: true };
};

A.rekap = async (u, b) => {
  needGuru(u);
  const kelas = String(b.kelas);
  const tasks = (await getTasks()).filter((t) => t.kelas === "all" || t.kelas === kelas).reverse();
  const sts = STUDENTS.filter((s) => s.k === kelas);
  const ids = new Set(sts.map((s) => s.n)), tids = new Set(tasks.map((t) => t.id));
  const keys = [];
  const r = await db().list({ prefix: "sub/" });
  for (const x of r.blobs) {
    const [, tid, n] = x.key.split("/");
    if (tids.has(tid) && ids.has(n)) keys.push({ tid, n, key: x.key });
  }
  const data = await pmap(keys, async (k) => ({ ...k, v: await getj(k.key) }));
  const m = {};
  for (const d of data) (m[d.n] ||= {})[d.tid] = { sc: d.v?.score ?? null, st: stat(d.v) };
  return {
    tasks: tasks.map((t) => ({ id: t.id, judul: t.judul, max: t.max })),
    rows: sts.map((s) => ({ n: s.n, nama: s.nama, m: m[s.n] || {} })),
  };
};

A.students = async (u) => { needGuru(u); return { rows: STUDENTS.map((s) => ({ n: s.n, nama: s.nama, k: s.k })) }; };

A.reset_pw = async (u, b) => {
  needGuru(u);
  const st = BY.get(String(b.nipd));
  if (!st) throw new E("Siswa tidak ditemukan", 404);
  const pw = genPw();
  const cur = (await getj(`pw/${st.n}`)) || {};
  if (b.who === "ortu") cur.o = hash(pw); else cur.s = hash(pw);
  await setj(`pw/${st.n}`, cur);
  return { pass: pw };
};

/* ---------- handler ---------- */
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Metode tidak didukung" }, 405);
  try {
    const b = await req.json();
    const u = await auth(b);
    if (!u) return json({ error: "Username atau password salah" }, 401);
    const fn = Object.hasOwn(A, b.action) ? A[b.action] : null;
    if (!fn) return json({ error: "Aksi tidak dikenal" }, 400);
    return json(await fn(u, b));
  } catch (e) {
    if (e instanceof E) return json({ error: e.message }, e.c);
    console.error(e);
    return json({ error: "Terjadi kesalahan server. Coba lagi." }, 500);
  }
};

export const config = { path: "/api" };
