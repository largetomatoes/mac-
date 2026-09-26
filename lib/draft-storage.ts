const API_PATH = "/api/drafts";
const LOCAL_PREFIX = "wenjian:draft:";

function unsupported(status: number) {
  return status === 404 || status === 405 || status === 501;
}

function localKey(key: string) {
  if (!key.trim()) throw new Error("草稿名称不能为空。");
  return `${LOCAL_PREFIX}${key}`;
}

function browserStorage(): Storage {
  if (typeof localStorage === "undefined") throw new Error("浏览器本地存储不可用。");
  return localStorage;
}

function readLocal<T>(key: string, fallback: T): T {
  const value = browserStorage().getItem(localKey(key));
  return value === null ? fallback : JSON.parse(value) as T;
}

function writeLocal(key: string, serialized: string): void {
  browserStorage().setItem(localKey(key), serialized);
}

function serverError(response: Response): Error {
  return new Error(`草稿服务返回错误（${response.status}）。`);
}

/** Read a draft from the local app, or from browser storage when the API is absent. */
export async function readDraft<T>(key: string, fallback: T): Promise<T> {
  try {
    localKey(key);
    const response = await fetch(API_PATH, { method: "GET", cache: "no-store" });
    if (unsupported(response.status)) return readLocal(key, fallback);
    if (!response.ok) throw serverError(response);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("drafts" in body) || !body.drafts || typeof body.drafts !== "object" || Array.isArray(body.drafts)) {
      throw new Error("草稿服务返回的数据格式不正确。");
    }
    const drafts = body.drafts as Record<string, unknown>;
    return Object.hasOwn(drafts, key) ? drafts[key] as T : fallback;
  } catch (error) {
    console.error("草稿读取失败：", error);
    throw error;
  }
}

/** Persist a JSON-serializable draft; reject so the UI can report any failure. */
export async function writeDraft(key: string, value: unknown): Promise<void> {
  try {
    localKey(key);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("草稿内容无法保存为 JSON。");
    const response = await fetch(API_PATH, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (unsupported(response.status)) {
      writeLocal(key, serialized);
      return;
    }
    if (!response.ok) throw serverError(response);
  } catch (error) {
    console.error("草稿保存失败：", error);
    throw error;
  }
}
