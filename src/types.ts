import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";

export type ExclusionPolicy = "same-model" | "same-provider";
export type DefaultReviewers = "all-eligible" | "ask";
export type WingmanMode = "audit" | "adversarial" | "consensus" | "rescue";
export type ReviewerStatus = "pending" | "running" | "ok" | "failed" | "cancelled";
export type WingmanBackend = "direct" | "subagent";

export type WingmanReviewerConfig = {
	name: string;
	provider: string;
	model: string;
	thinking?: ModelThinkingLevel;
};

export type WingmanLoggingConfig = {
	enabled: boolean;
	raw: boolean;
};

export type WingmanConfig = {
	version: 1;
	exclude: ExclusionPolicy;
	defaultReviewers: DefaultReviewers;
	maxRounds: number;
	maxParallelReviewers: number;
	logging: WingmanLoggingConfig;
	reviewers: WingmanReviewerConfig[];
};

export type ResolvedReviewer = WingmanReviewerConfig & {
	modelRef: Model<any>;
	label: string;
	key: string;
	sameProvider: boolean;
	sameModel: boolean;
};

export type WingmanTarget =
	| { type: "question-consensus"; question: string; confidence: "high" | "medium" | "low" }
	| { type: "current-plan"; text: string; confidence: "high" | "medium" | "low" }
	| { type: "working-tree"; confidence: "high" | "medium" | "low" }
	| { type: "branch-diff"; base: string; confidence: "high" | "medium" | "low" }
	| { type: "commit"; sha: string; confidence: "high" | "medium" | "low" }
	| { type: "files"; paths: string[]; confidence: "high" | "medium" | "low" }
	| { type: "last-turn"; text: string; confidence: "high" | "medium" | "low" }
	| { type: "freeform"; focus: string; confidence: "high" | "medium" | "low" };

export type WingmanContextPack = {
	target: WingmanTarget;
	label: string;
	focus: string;
	mode: WingmanMode;
	cwd: string;
	content: string;
	backend: WingmanBackend;
	reason: string;
};

export type ReviewerProgress = {
	reviewer: ResolvedReviewer;
	status: ReviewerStatus;
	round: number;
	summary?: string;
	error?: string;
};

export type ReviewerResult = {
	reviewer: ResolvedReviewer;
	status: Exclude<ReviewerStatus, "pending" | "running">;
	round: number;
	backend: WingmanBackend;
	prompt: string;
	output?: string;
	summary?: string;
	error?: string;
};

export type WingmanRunInput = {
	request: string;
	reviewerHint?: string;
	reviewerNames?: string[];
	targetHint?: string;
	maxRounds?: number;
	interactive?: boolean;
};

export type WingmanRunResult = {
	request: string;
	mode: WingmanMode;
	target: WingmanTarget;
	targetLabel: string;
	rounds: number;
	cancelled: boolean;
	results: ReviewerResult[];
	text: string;
};

export type ModelListItem = {
	provider: string;
	model: string;
	name: string;
	reasoning: boolean;
	modelRef: Model<any>;
};
