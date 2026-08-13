/**
 * GLM Coding Plan 用量监控(pi extension)
 *
 * 底部状态栏常驻显示 GLM Coding Plan 用量 + 下次刷新倒计时。
 * 零配置:自动复用 pi 已配的 GLM API Key(经 ModelRegistry 解析)。
 * 接口规格参考 cc-switch(farion1231/cc-switch)的 coding_plan.rs。
 *
 * 颜色(truecolor,绕开主题):<30% 绿、>=70% 橙、>=90% 红。
 * 单文件、零外部依赖:pi 用 bun 加载,类型在运行时由全局 pi 提供。
 *
 * 加载:.pi/extensions/(项目级)或 ~/.pi/agent/extensions/(全局)
 */

// ── 配置 ────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 3 * 60 * 1000; // 每 3 分钟刷新
const REQUEST_TIMEOUT_MS = 15_000;
const GLM_HOST_RE = /bigmodel\.cn|z\.ai/i; // 国内站 open.bigmodel.cn / 国际站 api.z.ai
// 代理场景兜底:provider 名字 AND key 形态都确认是智谱时,用官方主机查配额
const GLM_PROVIDER_NAME_RE = /zhipu|glm|bigmodel/i;
const GLM_KEY_RE = /^[0-9a-f]{32,}\.[A-Za-z0-9]+$/; // 智谱 key 形态: 32位hex id.secret
// 代理兜底主机:默认国内站;国际站用户可设环境变量 GLM_QUOTA_HOST=https://api.z.ai 覆盖
const DEFAULT_GLM_HOST = process.env.GLM_QUOTA_HOST ?? "https://open.bigmodel.cn";

// 鲜艳色(truecolor ANSI,footer 直接渲染,不依赖主题)
const VIVID = {
	green: "\x1b[38;2;52;199;89m", // #34c759 低用量
	orange: "\x1b[38;2;255;159;10m", // #ff9f0a 偏高
	red: "\x1b[38;2;255;69;58m", // #ff453a 告警
	reset: "\x1b[39m",
};

// ── 类型 ────────────────────────────────────────────────────────────
interface GlmTier {
	pct: number;
	resetMs?: number;
}
interface GlmLimitItem {
	type?: string;
	percentage?: number;
	nextResetTime?: number;
	unit?: number;
}
interface GlmQuotaData {
	level?: string;
	limits?: GlmLimitItem[];
}
interface GlmQuotaResponse {
	success?: boolean;
	msg?: string;
	data?: GlmQuotaData;
}
interface GlmUsage {
	level?: string;
	fiveHour?: GlmTier;
	weekly?: GlmTier;
	error?: string;
}
interface GlmCredential {
	apiKey: string;
	baseUrl: string;
}

// pi 上下文的结构化类型(避免 any,运行时鸭子类型)
interface ModelRegistryLike {
	getAvailable(): unknown[];
	getProvider(name: string): { baseUrl?: string } | undefined;
	getApiKeyForProvider(name: string): Promise<string | undefined>;
}
interface CtxLike {
	modelRegistry: ModelRegistryLike;
	ui?: {
		setStatus(key: string, text: string | undefined): void;
	};
}
// 最小化的扩展 API 类型(让单文件零外部依赖也能通过类型检查)
interface PiExtensionApi {
	on(
		event: "session_start",
		handler: (event: unknown, ctx: CtxLike) => void | Promise<void>,
	): void;
	on(event: "session_shutdown", handler: () => void): void;
}

// ── GLM 配额查询 ───────────────────────────────────────────────────
function quotaHost(baseUrl: string): string {
	return baseUrl.toLowerCase().includes("bigmodel.cn")
		? "https://open.bigmodel.cn"
		: "https://api.z.ai";
}

function toTier(item: GlmLimitItem | undefined): GlmTier | undefined {
	if (!item) return undefined;
	const tier: GlmTier = { pct: Number(item.percentage ?? 0) };
	const nrt = Number(item.nextResetTime);
	if (nrt > 0) tier.resetMs = nrt;
	return tier;
}

function parseGlmUsage(data: GlmQuotaData): GlmUsage {
	const tokens = (data.limits ?? []).filter(
		(it) => String(it.type ?? "").toUpperCase() === "TOKENS_LIMIT",
	);
	const pick = (unit: number): GlmTier | undefined =>
		toTier(tokens.find((it) => Number(it.unit) === unit));

	let fiveHour = pick(3);
	let weekly = pick(6);

	// 兜底:unit 缺失时,把未知条目按序填入空缺槽位
	for (const it of tokens.filter((x) => {
		const u = Number(x.unit);
		return u !== 3 && u !== 6;
	})) {
		const tier = toTier(it);
		if (!tier) continue;
		if (!fiveHour) fiveHour = tier;
		else if (!weekly) weekly = tier;
	}
	return { level: data.level, fiveHour, weekly };
}

async function fetchGlmQuota(
	cred: GlmCredential,
): Promise<GlmQuotaResponse | { error: string }> {
	const url = `${quotaHost(cred.baseUrl)}/api/monitor/usage/quota/limit`;
	const resp = await fetch(url, {
		headers: {
			Authorization: cred.apiKey, // 智谱特殊:不带 "Bearer " 前缀
			"Content-Type": "application/json",
			"Accept-Language": "en-US,en",
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (resp.status === 401 || resp.status === 403) {
		return { error: `认证失败 (HTTP ${resp.status})` };
	}
	if (!resp.ok) return { error: `HTTP ${resp.status}` };
	return (await resp.json()) as GlmQuotaResponse;
}

async function queryGlmUsage(cred: GlmCredential): Promise<GlmUsage> {
	let result: GlmQuotaResponse | { error: string };
	try {
		result = await fetchGlmQuota(cred);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { error: `查询异常: ${msg}` };
	}
	if ("error" in result) return { error: result.error };
	if (result.success === false) return { error: result.msg ?? "业务错误" };
	if (!result.data) return { error: "响应缺少 data 字段" };
	return parseGlmUsage(result.data);
}

// ── 格式化 ──────────────────────────────────────────────────────────
function fmtRemaining(resetMs?: number): string {
	if (!resetMs) return "";
	const diff = resetMs - Date.now();
	if (diff <= 0) return "即将刷新";
	const h = Math.floor(diff / 3_600_000);
	const m = Math.floor((diff % 3_600_000) / 60_000);
	if (h > 0) return `${h}h${m}m 后刷新`;
	if (m > 0) return `${m}m 后刷新`;
	return "<1m 后刷新";
}

function colorForPct(pct: number, text: string): string {
	if (pct >= 90) return `${VIVID.red}${text}${VIVID.reset}`;
	if (pct >= 70) return `${VIVID.orange}${text}${VIVID.reset}`;
	if (pct < 30) return `${VIVID.green}${text}${VIVID.reset}`;
	return text;
}

function fmtTier(label: string, tier: GlmTier | undefined): string {
	if (!tier) return "";
	const body = colorForPct(tier.pct, `${label} ${tier.pct.toFixed(0)}%`);
	const r = tier.resetMs ? ` · ${fmtRemaining(tier.resetMs)}` : "";
	return `${body}${r}`;
}

function fmtStatus(u: GlmUsage): string {
	if (u.error) return `${VIVID.red}GLM 用量: ${u.error}${VIVID.reset}`;
	const parts: string[] = [];
	if (u.level) parts.push(`GLM ${u.level}`);
	const fh = fmtTier("5h", u.fiveHour);
	if (fh) parts.push(fh);
	const wk = fmtTier("周", u.weekly);
	if (wk) parts.push(wk);
	return parts.length > 0 ? parts.join("  │  ") : "GLM: 暂无用量数据";
}

// ── 凭据发现(零配置:复用 pi 已配的 GLM)─────────────────────────
function providerNamesOf(models: unknown[]): string[] {
	const names = models
		.map((m) => (m as { provider?: string }).provider)
		.filter((p): p is string => typeof p === "string");
	return [...new Set(names)];
}

async function findGlmCredential(ctx: CtxLike): Promise<GlmCredential | null> {
	const reg = ctx.modelRegistry;
	for (const name of providerNamesOf(reg.getAvailable())) {
		const baseUrl = reg.getProvider(name)?.baseUrl;
		const directGlm = !!baseUrl && GLM_HOST_RE.test(baseUrl); // 直连智谱站点
		const nameLooksGlm = GLM_PROVIDER_NAME_RE.test(name); // provider 名像智谱(代理场景)

		// 安全门:只对"直连智谱"或"名字像智谱"的 provider 读取密钥,
		// 避免把其它 provider 的密钥误发到智谱端点
		if (!directGlm && !nameLooksGlm) continue;

		let apiKey: string | undefined;
		try {
			apiKey = await reg.getApiKeyForProvider(name);
		} catch {
			apiKey = undefined;
		}
		if (!apiKey) continue;

		// 1) 直连智谱:用 baseUrl 里的真实主机
		if (directGlm) return { apiKey, baseUrl: baseUrl! };
		// 2) 走代理(本地 baseUrl):provider 名 AND key 形态都确认是智谱 → 用默认官方主机
		if (GLM_KEY_RE.test(apiKey)) return { apiKey, baseUrl: DEFAULT_GLM_HOST };
	}
	return null;
}

// ── 插件入口 ────────────────────────────────────────────────────────
export default function (pi: PiExtensionApi): void {
	let timer: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", async (_event, ctx) => {
		let credential: GlmCredential | null = null;

		const refresh = async (): Promise<void> => {
			const ui = ctx.ui;
			if (!ui?.setStatus) return;
			if (!credential) {
				const found = await findGlmCredential(ctx);
				if (!found) {
					ui.setStatus("glm-usage", "GLM 用量: 未找到 GLM 凭据");
					return;
				}
				credential = found;
			}
			const usage = await queryGlmUsage(credential);
			ui.setStatus("glm-usage", fmtStatus(usage));
		};

		await refresh();
		if (timer) clearInterval(timer);
		timer = setInterval(refresh, POLL_INTERVAL_MS);
	});

	pi.on("session_shutdown", () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	});
}
