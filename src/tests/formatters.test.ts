import test from "node:test";
import assert from "node:assert/strict";
import {
	formatIssueOneLiner,
	formatIssueDetail,
	formatIssueList,
	formatPROneLiner,
	formatPRDetail,
	formatPRList,
	formatComment,
	formatCommentList,
	formatReview,
	formatReviewList,
	formatLabel,
	formatLabelList,
	formatMilestone,
	formatMilestoneList,
	formatFileChanges,
} from "../resources/extensions/github/formatters.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const now = new Date().toISOString();

const mockIssue = {
	number: 42,
	title: "Fix login bug",
	state: "open",
	body: "Users cannot log in after update",
	html_url: "https://github.com/owner/repo/issues/42",
	user: { login: "alice" },
	assignees: [{ login: "bob" }],
	labels: [{ name: "bug", color: "d73a4a", description: "Something isn't working" }],
	milestone: { title: "v1.0" },
	comments: 5,
	created_at: now,
	updated_at: now,
};

const mockPR = {
	number: 100,
	title: "Add dark mode",
	state: "open",
	draft: false,
	body: "Implements dark mode theme",
	html_url: "https://github.com/owner/repo/pull/100",
	user: { login: "carol" },
	assignees: [],
	labels: [],
	milestone: null,
	requested_reviewers: [{ login: "dave" }],
	comments: 2,
	review_comments: 1,
	merged_at: null,
	mergeable: true,
	mergeable_state: "clean",
	head: { ref: "feat/dark-mode" },
	base: { ref: "main" },
	created_at: now,
	updated_at: now,
};

const mockComment = {
	id: 1,
	body: "LGTM!",
	user: { login: "eve" },
	created_at: now,
	updated_at: now,
};

const mockReview = {
	id: 1,
	state: "APPROVED",
	body: "Ship it",
	user: { login: "frank" },
	submitted_at: now,
};

const mockLabel = {
	name: "enhancement",
	color: "a2eeef",
	description: "New feature request",
};

const mockMilestone = {
	title: "v2.0",
	state: "open",
	open_issues: 3,
	closed_issues: 7,
	due_on: "2026-06-01T00:00:00Z",
};

// ─── Issue formatting ────────────────────────────────────────────────────────

test("formatIssueOneLiner includes number and title", () => {
	const result = formatIssueOneLiner(mockIssue as any);
	assert.ok(result.includes("#42"));
	assert.ok(result.includes("Fix login bug"));
});

test("formatIssueOneLiner includes label", () => {
	const result = formatIssueOneLiner(mockIssue as any);
	assert.ok(result.includes("[bug]"));
});

test("formatIssueOneLiner includes assignee", () => {
	const result = formatIssueOneLiner(mockIssue as any);
	assert.ok(result.includes("bob"));
});

test("formatIssueOneLiner shows state icon for open issue", () => {
	const result = formatIssueOneLiner(mockIssue as any);
	assert.ok(result.startsWith("●"));
});

test("formatIssueOneLiner shows ✓ for closed issue", () => {
	const closed = { ...mockIssue, state: "closed" };
	const result = formatIssueOneLiner(closed as any);
	assert.ok(result.startsWith("✓"));
});

test("formatIssueDetail includes all sections", () => {
	const result = formatIssueDetail(mockIssue as any);
	assert.ok(result.includes("# Issue #42"));
	assert.ok(result.includes("@alice"));
	assert.ok(result.includes("Assignees: @bob"));
	assert.ok(result.includes("Labels: bug"));
	assert.ok(result.includes("Milestone: v1.0"));
	assert.ok(result.includes("Comments: 5"));
	assert.ok(result.includes("Users cannot log in"));
});

test("formatIssueDetail handles null body", () => {
	const noBody = { ...mockIssue, body: null };
	const result = formatIssueDetail(noBody as any);
	assert.ok(result.includes("(no description)"));
});

test("formatIssueList returns message for empty list", () => {
	assert.equal(formatIssueList([]), "No issues found.");
});

test("formatIssueList formats multiple issues", () => {
	const issues = [mockIssue, { ...mockIssue, number: 43, title: "Another" }] as any[];
	const result = formatIssueList(issues);
	assert.ok(result.includes("#42"));
	assert.ok(result.includes("#43"));
});

// ─── PR formatting ───────────────────────────────────────────────────────────

test("formatPROneLiner includes number and title", () => {
	const result = formatPROneLiner(mockPR as any);
	assert.ok(result.includes("#100"));
	assert.ok(result.includes("Add dark mode"));
});

test("formatPROneLiner shows draft indicator", () => {
	const draft = { ...mockPR, draft: true };
	const result = formatPROneLiner(draft as any);
	assert.ok(result.includes("(draft)"));
	assert.ok(result.startsWith("◇"));
});

test("formatPROneLiner shows merged state", () => {
	const merged = { ...mockPR, state: "closed", merged_at: now };
	const result = formatPROneLiner(merged as any);
	assert.ok(result.startsWith("⊕"));
});

test("formatPROneLiner shows reviewer", () => {
	const result = formatPROneLiner(mockPR as any);
	assert.ok(result.includes("dave"));
});

test("formatPRDetail includes branch info", () => {
	const result = formatPRDetail(mockPR as any);
	assert.ok(result.includes("feat/dark-mode → main"));
});

test("formatPRDetail includes mergeable state", () => {
	const result = formatPRDetail(mockPR as any);
	assert.ok(result.includes("Mergeable: yes"));
});

test("formatPRList returns message for empty list", () => {
	assert.equal(formatPRList([]), "No pull requests found.");
});

// ─── Comment formatting ──────────────────────────────────────────────────────

test("formatComment includes author and body", () => {
	const result = formatComment(mockComment as any);
	assert.ok(result.includes("@eve"));
	assert.ok(result.includes("LGTM!"));
});

test("formatCommentList returns message for empty list", () => {
	assert.equal(formatCommentList([]), "No comments.");
});

test("formatCommentList separates comments with divider", () => {
	const comments = [mockComment, { ...mockComment, body: "Thanks!" }] as any[];
	const result = formatCommentList(comments);
	assert.ok(result.includes("---"));
});

// ─── Review formatting ───────────────────────────────────────────────────────

test("formatReview shows APPROVED with checkmark", () => {
	const result = formatReview(mockReview as any);
	assert.ok(result.startsWith("✓"));
	assert.ok(result.includes("APPROVED"));
});

test("formatReview shows CHANGES_REQUESTED with ✗", () => {
	const changes = { ...mockReview, state: "CHANGES_REQUESTED" };
	const result = formatReview(changes as any);
	assert.ok(result.startsWith("✗"));
});

test("formatReviewList returns message for empty list", () => {
	assert.equal(formatReviewList([]), "No reviews.");
});

// ─── Label formatting ────────────────────────────────────────────────────────

test("formatLabel includes name and color", () => {
	const result = formatLabel(mockLabel as any);
	assert.ok(result.includes("enhancement"));
	assert.ok(result.includes("#a2eeef"));
});

test("formatLabel includes description", () => {
	const result = formatLabel(mockLabel as any);
	assert.ok(result.includes("New feature request"));
});

test("formatLabelList returns message for empty list", () => {
	assert.equal(formatLabelList([]), "No labels.");
});

// ─── Milestone formatting ────────────────────────────────────────────────────

test("formatMilestone shows progress percentage", () => {
	const result = formatMilestone(mockMilestone as any);
	assert.ok(result.includes("70%")); // 7/(3+7) = 70%
});

test("formatMilestone shows due date", () => {
	const result = formatMilestone(mockMilestone as any);
	assert.ok(result.includes("2026-06-01"));
});

test("formatMilestoneList returns message for empty list", () => {
	assert.equal(formatMilestoneList([]), "No milestones.");
});

// ─── File changes formatting ─────────────────────────────────────────────────

test("formatFileChanges returns message for empty list", () => {
	assert.equal(formatFileChanges([]), "No files changed.");
});

test("formatFileChanges shows additions and deletions", () => {
	const files = [
		{ filename: "src/app.ts", status: "modified", additions: 10, deletions: 3, changes: 13 },
		{ filename: "src/new.ts", status: "added", additions: 50, deletions: 0, changes: 50 },
	];
	const result = formatFileChanges(files);
	assert.ok(result.includes("~ src/app.ts  (+10 -3)"));
	assert.ok(result.includes("+ src/new.ts  (+50 -0)"));
	assert.ok(result.includes("2 files changed, +60 -3"));
});

test("formatFileChanges shows - for removed files", () => {
	const files = [{ filename: "old.ts", status: "removed", additions: 0, deletions: 20, changes: 20 }];
	const result = formatFileChanges(files);
	assert.ok(result.includes("- old.ts"));
});
