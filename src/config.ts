import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { WingmanConfig, WingmanReviewerConfig } from "./types.ts";

export const WINGMAN_DIR = ".wingman";
export const WINGMAN_CONFIG = "config.json";

export function projectRoot(cwd: string): string {
	let current = resolve(cwd);
	for (;;) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

export function configPath(cwd: string): string {
	return join(projectRoot(cwd), WINGMAN_DIR, WINGMAN_CONFIG);
}

export function hasWingmanConfig(cwd: string): boolean {
	return existsSync(configPath(cwd));
}

export const defaultWingmanConfig: WingmanConfig = {
	version: 1,
	exclude: "same-provider",
	defaultReviewers: "all-eligible",
	maxParallelReviewers: 4,
	logging: { enabled: false, raw: false },
	reviewers: [],
};

function asObject(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(parsed)));
}

const ALIAS_PATTERN = /^[a-z0-9._-]+$/;

function normalizeReviewer(value: unknown, index: number): WingmanReviewerConfig | undefined {
	const item = asObject(value);
	if (!item) return undefined;
	const provider = stringValue(item.provider);
	const model = stringValue(item.model);
	if (!provider || !model) return undefined;
	const name = stringValue(item.name);
	if (!name) throw new Error(`Wingman reviewer at index ${index} is missing required name alias.`);
	if (!ALIAS_PATTERN.test(name)) throw new Error(`Wingman reviewer alias "${name}" must match [a-z0-9._-]+.`);
	const thinking = stringValue(item.thinking) as WingmanReviewerConfig["thinking"] | undefined;
	return { name, provider, model, thinking };
}

function validateUniqueAliases(reviewers: WingmanReviewerConfig[]): void {
	const seen = new Map<string, WingmanReviewerConfig>();
	for (const reviewer of reviewers) {
		const existing = seen.get(reviewer.name);
		if (existing) throw new Error(`Duplicate Wingman reviewer alias "${reviewer.name}" for ${existing.provider}/${existing.model} and ${reviewer.provider}/${reviewer.model}. Aliases must be unique.`);
		seen.set(reviewer.name, reviewer);
	}
}

export function normalizeConfig(raw: unknown): WingmanConfig {
	const obj = asObject(raw) ?? {};
	const logging = asObject(obj.logging) ?? {};
	const reviewers = Array.isArray(obj.reviewers)
		? obj.reviewers.map(normalizeReviewer).filter((item): item is WingmanReviewerConfig => Boolean(item))
		: [];
	validateUniqueAliases(reviewers);
	const exclude = obj.exclude === "same-model" ? "same-model" : "same-provider";
	const defaultReviewers = obj.defaultReviewers === "ask" ? "ask" : "all-eligible";
	return {
		version: 1,
		exclude,
		defaultReviewers,
		maxParallelReviewers: numberValue(obj.maxParallelReviewers, defaultWingmanConfig.maxParallelReviewers, 1, 16),
		logging: { enabled: Boolean(logging.enabled), raw: Boolean(logging.raw) },
		reviewers,
	};
}

export async function readWingmanConfig(cwd: string): Promise<WingmanConfig> {
	try {
		const text = await readFile(configPath(cwd), "utf8");
		return normalizeConfig(JSON.parse(text));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultWingmanConfig, logging: { ...defaultWingmanConfig.logging }, reviewers: [] };
		throw error;
	}
}

export async function writeWingmanConfig(cwd: string, config: WingmanConfig): Promise<void> {
	const normalized = normalizeConfig(config);
	const path = configPath(cwd);
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	await rename(temp, path);
}
